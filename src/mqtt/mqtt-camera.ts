import { Connection } from '../connection/connection';
import { DEFAULT } from '../constants';
import { CameraControlValue } from '../constants/camera-property';
import { CommanderPeer } from '../peer/commander-peer';
import { ChannelRole, IpcMode, IpcOptions, RequestType, RtcPeer } from '../peer/rtc-peer';
import { CameraControlId } from '../proto/camera_control';
import { QueryFileResponse, RecordingResponse, VideoMode } from '../proto/packet';
import { MqttClient } from '../signaling/mqtt-client';
import { withMaxBitrate } from '../utils/rtc-tools';
import { MqttCameraOptions } from './types';

/**
 * One device, directly: SDP and ICE go through an MQTT broker, then video, audio and data go
 * peer to peer. Besides what every connection has, it takes snapshots, records, lists and
 * downloads recordings, and sets camera controls.
 */
export class MqttCamera extends Connection {
  /** A `snapshot()` arrived, as a data URL. */
  onSnapshot?: (base64: string) => void;
  /** `fetchVideoList()` answered. */
  onVideoListLoaded?: (res: QueryFileResponse) => void;
  /** `downloadVideoFile()` finished. */
  onVideoDownloaded?: (file: Uint8Array) => void;
  /** How much of a snapshot, file or large IPC message has arrived. */
  onProgress?: (received: number, total: number, type: RequestType, requestId?: string) => void;
  /** The device answered `startRecording()` or `stopRecording()`. */
  onRecording?: (res: RecordingResponse) => void;
  /** A data channel opened. */
  onDatachannel?: (role: ChannelRole) => void;

  readonly deviceId: string;
  private readonly options: MqttCameraOptions;
  private client?: MqttClient;
  private peer?: CommanderPeer;

  constructor(options: MqttCameraOptions) {
    super(options, { timeout: DEFAULT.SIGNALING_TIMEOUT, isMicOn: true });
    if (!options.deviceId || !options.host) {
      throw new Error('MqttCamera needs deviceId and host.');
    }
    this.deviceId = options.deviceId;
    this.options = { ...options };
    const kbps = this.options.maxBitrate;
    if (kbps !== undefined && (!Number.isFinite(kbps) || kbps <= 0)) {
      console.warn(`Ignoring a maxBitrate of ${kbps}: it has to be a positive number of kbps.`);
      this.options.maxBitrate = undefined;
    }
  }

  /**
   * Lists recordings.
   * - Without arguments: the latest recording.
   * - With a file path (`param`): up to 8 recordings before that file.
   * - With a date (`param`): the recording closest to that time.
   * - With `mode`: only recordings of that video mode.
   */
  fetchVideoList(options?: { param?: string | Date; mode?: VideoMode }): void {
    if (this.onVideoListLoaded) {
      this.peer?.fetchVideoList(options);
    }
  }

  /** Downloads a recording. It arrives on `onVideoDownloaded`. */
  downloadVideoFile(path: string): void {
    if (this.onVideoDownloaded) {
      this.peer?.downloadVideoFile(path);
    }
  }

  /** Sets a camera control, such as focus or exposure. */
  setCameraControl(key: CameraControlId, value: CameraControlValue): void {
    this.peer?.setCameraControl(key, value);
  }

  /** Asks for a still image. `quality` is `0` to `100`, `30` by default. It arrives on `onSnapshot`. */
  snapshot(quality: number = 30): void {
    this.peer?.snapshot(quality);
  }

  /** The answer arrives on `onRecording`. */
  startRecording(): void {
    this.peer?.startRecording();
  }

  /** The answer arrives on `onRecording`. */
  stopRecording(): void {
    this.peer?.stopRecording();
  }

  protected open(): void {
    const options = this.options;
    const client = new MqttClient({
      deviceId: options.deviceId,
      host: options.host,
      port: options.port,
      path: options.path ?? '/mqtt',
      protocol: options.protocol ?? 'wss',
      username: options.username,
      password: options.password,
    });
    this.client = client;

    const peer = new CommanderPeer({
      options: { ...this.peerOptions(), codec: options.codec, datachannelOnly: options.datachannelOnly },
      iceServers: this.iceServers(),
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.peer = peer;

    peer.onSfuStream = (id, stream) => this.onStream?.(stream, id);
    peer.onIceCandidate = (ice) => client.send('ice', JSON.stringify(ice.candidate));
    peer.onConnectionStateChange = (state) => this.onPeerState(state);
    peer.onReconnectFailed = () => this.fail({ code: 'reconnect_failed', message: 'The connection to the device dropped and could not be restored.' });
    peer.onSnapshot = (base64) => this.onSnapshot?.(base64);
    peer.onVideoListLoaded = (res) => this.onVideoListLoaded?.(res);
    peer.onProgress = (received, total, type, requestId) => this.onProgress?.(received, total, type, requestId);
    peer.onVideoDownloaded = (file) => this.onVideoDownloaded?.(file);
    peer.onDatachannel = (role) => this.onDatachannel?.(role);
    peer.onMessage = (data) => this.onMessage?.(data, this.deviceId);
    peer.onRecording = (res) => this.onRecording?.(res);
    peer.onOffer = (offer) => client.send('offer', JSON.stringify(this.capBitrate(offer)));

    client.onIceCandidate = (ice) => peer.addIceCandidate(ice);
    client.onAnswer = (sdp) => peer.setRemoteDescription(sdp);
    client.onOffer = async (sdp) => {
      const answer = await peer.createAnswer(sdp);
      if (answer) {
        client.send('answer', JSON.stringify(this.capBitrate(answer)));
      }
    };
    client.onError = (err) => this.emitError({ code: 'signaling', message: err.message });
    client.onConnect = () => {
      if (peer.connectionState === 'new') {
        peer.createOffer();
      } else {
        peer.notifySignalingReconnected();
      }
    };
    client.connect();
  }

  protected close(): void {
    this.peer?.close();
    this.peer = undefined;
    this.client?.disconnect();
    this.client = undefined;
  }

  protected peers(): RtcPeer[] {
    return this.peer ? [this.peer] : [];
  }

  protected deliver(data: Uint8Array, mode: IpcMode, options?: IpcOptions): boolean {
    if (!this.peer?.canSend(mode)) {
      return false;
    }
    this.peer.sendToEndpoint(data, mode, options);
    return true;
  }

  protected deliverable(mode: IpcMode): boolean {
    return this.peer?.canSend(mode) ?? false;
  }

  private onPeerState(state: RTCPeerConnectionState): void {
    if (state === 'connected') {
      this.setStatus('connected');
    } else if ((state === 'disconnected' || state === 'failed') && this.status === 'connected') {
      // The peer restarts ICE on its own; onReconnectFailed says when it gives up.
      this.setStatus('reconnecting');
    }
  }

  /**
   * The description to send the device, with `maxBitrate` written into it. Applied to answers
   * too: a device that renegotiates would otherwise read an uncapped answer and lift the cap.
   */
  private capBitrate(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    const kbps = this.options.maxBitrate;
    if (!kbps || !description.sdp) {
      return description;
    }
    return { ...description, sdp: withMaxBitrate(description.sdp, kbps) };
  }

  private iceServers(): RTCIceServer[] {
    const { stunUrls, turnUrls, turnUsername, turnPassword } = this.options;
    const servers: RTCIceServer[] = [];
    if (stunUrls && stunUrls.length > 0) {
      servers.push({ urls: stunUrls });
    }
    if (turnUrls && turnUsername && turnPassword) {
      servers.push({ urls: turnUrls, username: turnUsername, credential: turnPassword });
    }
    return servers;
  }
}
