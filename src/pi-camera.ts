import { MqttClient } from './signaling/mqtt-client';
import { SignalingClient } from './signaling/signaling-client';
import { PiCameraApi, PiCameraOptions } from './pi-camera.types';
import { LiveKitClient, Participant, Quality, RoomInfo, Speaking } from './signaling/livekit-client';
import { CloudflareClient } from './signaling/cloudflare-client';
import { DeviceSession } from './signaling/picamera-api';
import { ChannelRole, IpcMode, IpcOptions, IpcSink, RequestType, RtcPeerConfig } from './peer/rtc-peer';
import { CommanderPeer } from './peer/commander-peer';
import { SubscriberPeer } from './peer/subscriber-peer';
import { PublisherPeer } from './peer/publisher-peer';
import { CloudflarePeer } from './peer/cloudflare-peer';
import { DEFAULT } from './constants';
import { QueryFileResponse, RecordingResponse, VideoMode } from './proto/packet';
import { CameraControlId } from './proto/camera_control';
import { CameraControlValue } from './constants/camera-property';
import { withMaxBitrate } from './utils/rtc-tools';

export class PiCamera implements PiCameraApi, IpcSink {
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onDatachannel?: (role: ChannelRole) => void;
  onSnapshot?: (base64: string) => void;
  onStream?: (stream: MediaStream) => void;
  onSfuStream?: (sid: string, stream: MediaStream) => void;
  onVideoListLoaded?: (res: QueryFileResponse) => void;
  onProgress?: (received: number, total: number, type: RequestType, requestId?: string) => void;
  onVideoDownloaded?: (file: Uint8Array) => void;
  onMessage?: (data: Uint8Array) => void;
  onRecording?: (res: RecordingResponse) => void;
  onTimeout?: () => void;
  onError?: (err: Error) => void;

  onRoomInfo?: (room: RoomInfo) => void;
  onQuality?: (quality: Quality[]) => void;
  onSpeaking?: (speaking: Speaking[]) => void;
  onParticipant?: (participant: Participant[]) => void;
  onDeviceSession?: (session: DeviceSession) => void;

  private options: PiCameraOptions;
  private client!: SignalingClient<any, any>;
  private rtcTimer?: NodeJS.Timeout;
  private isConnecting = false;
  private isTerminated = false;

  private cmdPeer?: CommanderPeer;
  private subPeer?: SubscriberPeer;
  private pubPeer?: PublisherPeer;
  private cfPeer?: CloudflarePeer;

  constructor(options: PiCameraOptions) {
    this.options = this.initializeOptions(options);
    this.initializeSession();
  }

  private initializeSession = () => {
    this.cmdPeer = undefined;
    this.subPeer = undefined;
    this.pubPeer = undefined;
    this.cfPeer = undefined;

    if (this.options.signaling === 'mqtt') {
      this.client = new MqttClient(this.options);
      this.InitializeCmdPeer(this.client as MqttClient);
    } else if (this.options.signaling === 'livekit') {
      this.client = new LiveKitClient(this.options);
      this.InitializeLivekitPeer(this.client as LiveKitClient);
    } else if (this.options.signaling === 'cloudflare') {
      this.client = new CloudflareClient(this.options);
      this.InitializeCloudflarePeer(this.client as CloudflareClient);
    } else {
      throw ("unknow signaling method.")
    }
  }

  connect = () => {
    if (this.isConnecting) {
      console.warn("PiCamera is already connecting, ignoring the duplicated connect().");
      return;
    }

    if (this.isTerminated) {
      this.initializeSession();
      this.isTerminated = false;
    }
    this.isConnecting = true;

    this.client.connect();

    if (this.options.timeout !== 0) {
      this.rtcTimer = setTimeout(() => {
        this.rtcTimer = undefined;
        if (this.isPeerConnected()) {
          return;
        }

        console.warn("RTC connection timeout.");
        this.onTimeout?.();
        this.terminate();
      }, this.options.timeout);
    }
  }

  terminate = () => {
    if (this.isTerminated) {
      return;
    }
    this.isTerminated = true;
    this.isConnecting = false;

    clearTimeout(this.rtcTimer);
    this.rtcTimer = undefined;
    this.cmdPeer?.close();
    this.subPeer?.close();
    this.pubPeer?.close();
    this.cfPeer?.close();
    this.client.disconnect();
    this.onConnectionState?.('closed');
    console.debug("PiCamera connections had been terminated.");
  }

  private isPeerConnected = (): boolean => {
    return this.cmdPeer?.connectionState === 'connected' ||
      this.subPeer?.connectionState === 'connected' ||
      this.pubPeer?.connectionState === 'connected' ||
      this.cfPeer?.connectionState === 'connected';
  }

  getStatus = (): RTCPeerConnectionState => {
    const peer = this.cmdPeer ?? this.subPeer ?? this.cfPeer;
    return peer ? peer.connectionState : 'new';
  }

  // The receiving peer, so inbound-rtp is in the report. Undefined before there is one.
  getStats = (selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined => {
    const peer = this.cmdPeer ?? this.subPeer ?? this.cfPeer;
    return peer?.getStats(selector);
  }

  refresh = async (): Promise<number> => {
    if (this.client instanceof CloudflareClient) {
      return this.client.refresh();
    }
    return 0;
  }

  fetchVideoList(options?: { param?: string | Date, mode?: VideoMode }): void {
    if (this.onVideoListLoaded) {
      this.cmdPeer?.fetchVideoList(options);
    }
  }

  downloadVideoFile(path: string): void {
    if (this.onVideoDownloaded) {
      this.cmdPeer?.downloadVideoFile(path);
    }
  }

  setCameraControl = (key: CameraControlId, value: CameraControlValue) => {
    this.cmdPeer?.setCameraControl(key, value);
  }

  snapshot = (quality: number = 30) => {
    this.cmdPeer?.snapshot(quality);
  }

  sendText = (msg: string, mode: IpcMode = 'reliable') => {
    this.cmdPeer?.sendText(msg, mode);
    this.pubPeer?.sendText(msg, mode);
  }

  sendData = (data: Uint8Array, mode: IpcMode = 'reliable') => {
    this.cmdPeer?.sendData(data, mode);
    this.pubPeer?.sendData(data, mode);
  }

  /**
   * @internal Send to one of the device's named IPC endpoints.
   */
  sendToEndpoint = (data: Uint8Array, mode: IpcMode = 'reliable', options?: IpcOptions) => {
    this.cmdPeer?.sendToEndpoint(data, mode, options);
    this.pubPeer?.sendToEndpoint(data, mode, options);
  }

  /** Whether an IPC payload sent right now would reach the device. */
  canSend = (mode: IpcMode = 'reliable'): boolean => {
    return (this.cmdPeer?.canSend(mode) ?? false) || (this.pubPeer?.canSend(mode) ?? false);
  }

  startRecording = () => {
    this.cmdPeer?.startRecording();
  }

  stopRecording = () => {
    this.cmdPeer?.stopRecording();
  }

  toggleMic = (enabled: boolean = !this.options.isMicOn) => {
    this.cmdPeer?.toggleMic(enabled);
    this.pubPeer?.toggleMic(enabled);
    this.subPeer?.toggleMic(enabled);
  }

  toggleSpeaker = (enabled: boolean = !this.options.isSpeakerOn) => {
    this.cmdPeer?.toggleSpeaker(enabled);
    this.pubPeer?.toggleSpeaker(enabled);
    this.subPeer?.toggleSpeaker(enabled);
  }

  // The publisher has no receivers
  setJitterBufferTarget = (target: number | null) => {
    this.options.jitterBufferTarget = target;
    this.cmdPeer?.setJitterBufferTarget(target);
    this.subPeer?.setJitterBufferTarget(target);
    this.cfPeer?.setJitterBufferTarget(target);
  }

  getJitterBufferTarget = (): number | null | undefined => {
    return this.options.jitterBufferTarget;
  }

  private initializeOptions(userOptions: PiCameraOptions): PiCameraOptions {
    const defaultOptions = {
      signaling: 'mqtt',
      mqttProtocol: 'wss',
      mqttPath: '/mqtt',
      timeout: DEFAULT.SIGNALING_TIMEOUT,
      datachannelOnly: false,
      isMicOn: true,
      isSpeakerOn: true,
    } as PiCameraOptions;

    const options = { ...defaultOptions, ...userOptions };

    if (options.codec && options.signaling !== 'mqtt') {
      console.warn(`The codec option only applies to mqtt; ignoring ${options.codec} on ${options.signaling}.`);
      options.codec = undefined;
    }

    if (options.maxBitrate !== undefined) {
      if (options.signaling !== 'mqtt') {
        console.warn(
          `The maxBitrate option only applies to mqtt; ignoring it on ${options.signaling}. ` +
          `Set --max-bitrate on the device instead.`
        );
        options.maxBitrate = undefined;
      } else if (!Number.isFinite(options.maxBitrate) || options.maxBitrate <= 0) {
        console.warn(`Ignoring a maxBitrate of ${options.maxBitrate}: it has to be a positive number of kbps.`);
        options.maxBitrate = undefined;
      }
    }

    return options;
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

  /** An SFU hands over its own relay on connect, which replaces the STUN/TURN the options carried. */
  private getRtcConfig = (options: PiCameraOptions, iceServers?: RTCIceServer[]): RtcPeerConfig => {
    const servers: RTCIceServer[] = [];

    if (options.stunUrls && options.stunUrls.length > 0) {
      servers.push({ urls: options.stunUrls });
    }

    if (options.turnUrls && options.turnUsername && options.turnPassword) {
      servers.push({
        urls: options.turnUrls,
        username: options.turnUsername,
        credential: options.turnPassword,
      });
    }

    return {
      options,
      iceServers: iceServers ?? servers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };
  }

  private InitializeCmdPeer = async (conn: MqttClient) => {
    this.cmdPeer = new CommanderPeer(this.getRtcConfig(this.options));

    this.cmdPeer.onStream = (stream) => this.onStream?.(stream);
    this.cmdPeer.onSfuStream = (sid, stream) => this.onSfuStream?.(sid, stream);
    this.cmdPeer.onIceCandidate = (ice) => conn.send('ice', JSON.stringify(ice.candidate));
    this.cmdPeer.onConnectionStateChange = (state) => {
      this.onConnectionState?.(state);
      if (state === "connected" && this.client?.isConnected()) {
        // Sometime need to wait renegotiation after connection established.
        // this.client.disconnect();
      }
    };
    this.cmdPeer.onReconnectFailed = () => this.terminate();

    this.cmdPeer.onSnapshot = (base64) => this.onSnapshot?.(base64);
    this.cmdPeer.onVideoListLoaded = (res) => this.onVideoListLoaded?.(res);
    this.cmdPeer.onProgress = (received, total, type, requestId) => this.onProgress?.(received, total, type, requestId);
    this.cmdPeer.onVideoDownloaded = (file) => this.onVideoDownloaded?.(file);
    this.cmdPeer.onDatachannel = (id) => this.onDatachannel?.(id);
    this.cmdPeer.onMessage = (data) => this.onMessage?.(data);
    this.cmdPeer.onRecording = (res) => this.onRecording?.(res);
    this.cmdPeer.onOffer = async (offer) => conn.send('offer', JSON.stringify(this.capBitrate(offer)));

    conn.onIceCandidate = (ice) => this.cmdPeer?.addIceCandidate(ice);
    conn.onAnswer = (sdp) => this.cmdPeer?.setRemoteDescription(sdp);
    conn.onOffer = async (sdp) => {
      const answer = await this.cmdPeer?.createAnswer(sdp);
      if (answer) {
        conn.send('answer', JSON.stringify(this.capBitrate(answer)));
      }
    };
    conn.onError = (err) => this.onError?.(err);
    conn.onConnect = () => {
      if (this.cmdPeer?.connectionState === 'new') {
        this.cmdPeer.createOffer();
      } else {
        this.cmdPeer?.notifySignalingReconnected();
      }
    };
  }

  private InitializeLivekitPeer(conn: LiveKitClient) {
    conn.onConnect = () => {
      // console.debug("WebSocket connected!");
    };

    conn.onJoin = async (server) => {
      const config: RtcPeerConfig = this.getRtcConfig(this.options, [server]);

      this.pubPeer = new PublisherPeer(config);
      this.pubPeer.onDatachannel = (id) => this.onDatachannel?.(id);
      this.pubPeer.onIceCandidate = (ev) => {
        if (ev.candidate) {
          conn.send('tricklePublisher', JSON.stringify(ev.candidate));
        }
      }
      this.pubPeer.onOffer = async (offer) => {
        conn.send('offer', offer.sdp);
      }
      this.pubPeer.onReconnectFailed = () => this.terminate();

      this.subPeer = new SubscriberPeer(config);
      this.subPeer.onMessage = (data) => this.onMessage?.(data);
      this.subPeer.onStream = (stream) => this.onStream?.(stream);
      this.subPeer.onSfuStream = (sid, stream) => this.onSfuStream?.(sid, stream);
      this.subPeer.onConnectionStateChange = (state) => this.onConnectionState?.(state);
      this.subPeer.onIceCandidate = (ev) => {
        if (ev.candidate) {
          conn.send('trickleSubscriber', JSON.stringify(ev.candidate));
        }
      }
      this.subPeer.onReconnectFailed = () => this.terminate();

      await this.pubPeer.createOffer();

      // conn.publish("addAudioTrack", this.trackId);
    };

    conn.onOffer = async (sdp) => {
      let answer = await this.subPeer?.createAnswer(sdp);
      if (answer) {
        conn.send('answer', answer.sdp);
      }
    };

    conn.onAnswer = async (sdp) => this.pubPeer?.setRemoteDescription(sdp);
    conn.onPublisherIce = async (ice) => this.pubPeer?.addIceCandidate(ice);
    conn.onSubscriberIce = async (ice) => this.subPeer?.addIceCandidate(ice);

    conn.onTrackPublished = () => {
      // let offer = await this.pubPeer?.createOffer();
      // this.pubPeer?.setLocalDescription(offer);
      // if (offer?.sdp) {
      //   conn.publish('offer', offer.sdp);
      // }
    };

    conn.onParticipant = (msg) => this.onParticipant?.(msg);
    conn.onRoomInfo = (msg) => this.onRoomInfo?.(msg);
    conn.onQuality = (msg) => this.onQuality?.(msg);
    conn.onSpeaking = (msg) => this.onSpeaking?.(msg);
    conn.onLeave = async () => this.terminate();
  }

  private InitializeCloudflarePeer(conn: CloudflareClient) {
    conn.onDeviceSession = (session) => this.onDeviceSession?.(session);
    conn.onError = (err) => this.onError?.(err);
    conn.onLeave = () => this.terminate();

    conn.onJoin = (iceServers) => {
      const config: RtcPeerConfig = this.getRtcConfig(this.options, iceServers);

      this.cfPeer = new CloudflarePeer(config);
      this.cfPeer.onStream = (stream) => this.onStream?.(stream);
      this.cfPeer.onSfuStream = (trackName, stream) => this.onSfuStream?.(trackName, stream);
      this.cfPeer.onConnectionStateChange = (state) => this.onConnectionState?.(state);
      this.cfPeer.onReconnectFailed = () => this.terminate();
    };

    conn.onTrackMap = (map) => this.cfPeer?.setTrackNames(map);

    conn.onOffer = async (sdp) => {
      const answer = await this.cfPeer?.createAnswer(sdp);
      if (answer?.sdp) {
        conn.send('answer', answer.sdp);
      }
    };
  }
}
