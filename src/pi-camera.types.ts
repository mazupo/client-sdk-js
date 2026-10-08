import { CodecType } from './utils/rtc-tools';
import { MqttConnectionOptions, MqttTopicType } from './signaling/mqtt-client';
import {
  LiveKitConnectionOptions,
  LiveKitActionType,
  Participant,
  Quality,
  RoomInfo,
  Speaking,
} from './signaling/livekit-client';
import { CloudflareActionType } from './signaling/cloudflare-client';
import { DeviceSession, ApiConnectionOptions } from './signaling/picamera-api';
import { ChannelRole, IpcMode, RequestType } from './peer/rtc-peer';
import { QueryFileResponse, RecordingResponse, VideoMode } from './proto/packet';
import { CameraControlId } from './proto/camera_control';
import { CameraControlValue } from './constants/camera-property';

/**
 * MediaStream extended with toURL() for React Native (react-native-webrtc).
 * When using @mazupo/client in React Native, call registerGlobals() from
 * react-native-webrtc at app startup to inject this method at runtime.
 */
export interface RNMediaStream extends MediaStream {
  toURL(): string;
}

/**
 * Which backend the device is reachable through. Named for the backend rather than for the
 * transport, matching pi-webrtc's `--use-mqtt` / `--use-livekit` / `--use-cloudflare`; both SFU
 * options in fact reach their backend through the same picamera device API.
 */
export type SignalingType = 'mqtt' | 'livekit' | 'cloudflare';

export interface PiCameraOptions
  extends MqttConnectionOptions, LiveKitConnectionOptions, ApiConnectionOptions {
  signaling?: SignalingType;

  /**
   * The uid pi-webrtc was started with (its `--uid` flag) — the device's own id, not a browser
   * or session id.
   *
   * mqtt:       prefixes the signaling topics the device subscribes to.
   * cloudflare: looked up through `GET /devices/{uid}` to find which SFU session the device is
   *             currently publishing into.
   */
  uid?: string;

  stunUrls?: string[];
  turnUrls?: string[];
  turnUsername?: string;
  turnPassword?: string;
  timeout?: number;
  datachannelOnly?: boolean;
  isMicOn?: boolean;
  isSpeakerOn?: boolean;

  /**
   * Video codec requested from the device. Only used with `mqtt`.
   * With `livekit` or `cloudflare`, the SFU forwards the device's negotiated codec.
   */
  codec?: CodecType;

  /**
   * The most video bitrate the device may send to this viewer, in kbps. Only used with `mqtt`,
   * where each viewer has its own connection and encoder on the device. The device lowers the
   * resolution first to stay under it, and keeps the frame rate.
   *
   * Set when connecting; to change it, connect again. With `livekit` or `cloudflare` every
   * viewer shares one stream, whose cap is the device's own `--max-bitrate`.
   */
  maxBitrate?: number;

  /**
   * How much media the receive jitter buffer should hold, in milliseconds (`0`-`4000`).
   * Lower means less playout delay but less room to ride out jitter and recover lost packets.
   */
  jitterBufferTarget?: number | null;
}

export type ActionType = LiveKitActionType | MqttTopicType | CloudflareActionType;

export interface PiCameraEvents {
  /**
   * Emitted when the WebRTC peer connection state changes.
   *
   * @param state - The new state of the RTCPeerConnection.
   */
  onConnectionState?: (state: RTCPeerConnectionState) => void;

  /**
   * Emitted when the data channel is successfully opened.
   *
   * @param role - Which channel opened.
   */
  onDatachannel?: (role: ChannelRole) => void;

  /**
   * If any data transfer by datachannel, the on progress will give the received/total info.
   * @param received 
   * @param total 
   */
  onProgress?: (received: number, total: number, type: RequestType, requestId?: string) => void;

  /**
   * Attaches the remote media stream to the specified media element for playback.
   *
   * @param stream - The HTML video element where the remote media stream will be rendered.
   */
  onStream?: (stream: MediaStream) => void;

  /**
   * Triggered only when a media stream is received from the SFU, delivering
   * both the participant's server-side ID (sid) and the associated MediaStream.
   *
   * @param sid - Server-side participant ID.
   * @param stream - The remote media stream.
   */
  onSfuStream?: (sid: string, stream: MediaStream) => void;

  /**
   * Emitted after calling the `snapshot()` method. This event emits a base64-encoded image 
   * once all image packets are received from the server.
   *
   * @param base64 - The base64 string representing the captured image.
   */
  onSnapshot?: (base64: string) => void;

  /**
   * Emitted when the video file list is retrieved.
   *
   * @param res - The file list response.
   */
  onVideoListLoaded?: (res: QueryFileResponse) => void;

  /**
   * Emitted when a video file is successfully downloaded from the server.
   * @param file 
   * @returns 
   */
  onVideoDownloaded?: (file: Uint8Array) => void;

  /**
   * Emitted when a IPC message is received.
   *
   * @param data - The binary message received from the remote peer.
   */
  onMessage?: (data: Uint8Array) => void;

  /**
   * Emitted when the server responds to a `startRecording()` or `stopRecording()` command.
   *
   * @param res - `isRecording` indicates the current recording state; `filepath` is the
   *              active recording file path (empty string when recording is stopped).
   */
  onRecording?: (res: RecordingResponse) => void;

  /**
   * Emitted when the P2P connection cannot be established within the allotted time.
   * Automatically triggers the `terminate()` function.
   */
  onTimeout?: () => void;

  /**
   * Emitted when signaling fails for a reason worth putting in front of a user — a device that
   * has never reported a session, one that is registered but not publishing, a track the SFU
   * refused. Distinct from `onTimeout`, which only says the peer never came up.
   *
   * @param err - What went wrong.
   */
  onError?: (err: Error) => void;

  /**
   * Emitted on the `cloudflare` path once the device's session record has been read, before the
   * peer is built. Cloudflare mints a new session id on every device reconnect, so this is the
   * only place the current one is visible.
   *
   * @param session - What the device last reported it is publishing into.
   */
  onDeviceSession?: (session: DeviceSession) => void;

  /**
   * Emitted when the SFU room information changes.
   * 
   * @param room - The room information, including the room ID and name.
   * @returns 
   */
  onRoomInfo?: (room: RoomInfo) => void;

  /**
   * Emitted when the quality of SFU connections change.
   *
   * @param quality - The new quality settings for the video stream.
   */
  onQuality?: (quality: Quality[]) => void;

  /**
   * Emitted when an SFU participant starts or stops speaking.
   *
   * @param speaking - The list of participants who are currently speaking.
   */
  onSpeaking?: (speaking: Speaking[]) => void;

  /**
   * Emitted when the list of participants in the SFU room changes.
   *
   * @param participant - Update the participants' state currently in the room.
   */
  onParticipant?: (participant: Participant[]) => void;

}

export interface PiCameraApi extends PiCameraEvents {
  /**
   * Start trying to establish the WebRTC connection.
   */
  connect(): void;

  /**
   * Terminates the WebRTC connection.
   */
  terminate(): void;

  /**
   * Retrieves the current connection status.
   */
  getStatus(): RTCPeerConnectionState;

  /**
   * The browser's `RTCStatsReport` for the receiving peer — where `inbound-rtp` reports the
   * jitter buffer, freezes and packet loss actually being seen. `undefined` before a peer exists.
   *
   * @param selector - Limit the report to one track.
   */
  getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined;

  /**
   * Pulls whatever the device has started publishing since the connection was established, and
   * resolves to how many tracks that was. Rejects if the SFU refuses.
   *
   * Only the `cloudflare` path has anything to re-read; elsewhere new tracks arrive on their own
   * and this resolves to `0`.
   */
  refresh(): Promise<number>;

  /**
  * Retrieves the list of video files.
  * - If called without arguments, returns metadata of the latest recorded file.
  * - If provided with a file path (`param`), returns metadata of up to 8 older recordings before the given file.
  * - If provided with a date (`param`), returns metadata of the closest recorded file to that time.
  * - If provided with a `mode`, filters results to that video mode.
  * 
  * @param options.param - A file path (string) or date (Date) to paginate or filter results.
  * @param options.mode - The video mode to filter the query.
  */
  fetchVideoList(options?: { param?: string | Date, mode?: VideoMode }): void;

  /**
   * Requests a video file from the server.
   * 
   * @param path - The path to the video file.
   */
  downloadVideoFile(path: string): void;

  /**
   * Sets the camera control, such as 3A or so.
   * @param key Camera control type
   * @param value Value of the camera control
   */
  setCameraControl(key: CameraControlId, value: CameraControlValue): void;

  /**
   * Requests a snapshot image from the server.
   * 
   * @param quality - The range from `0` to `100`, determines the image quality. The default value is `30`.
   */
  snapshot(quality?: number): void;

  /**
   * Send a message to the device's IPC socket.
   *
   * @param msg - The custom contents.
   */
  sendText(msg: string, mode?: IpcMode): void;

  /**
   * Send binary data to the device's IPC socket.
   *
   * @param msg - The custom contents.
   */
  sendData(msg: Uint8Array, mode?: IpcMode): void;

  /**
   * Whether an IPC payload sent right now would reach the device.
   *
   * @param mode - Which IPC channel the payload would go out on.
   */
  canSend(mode?: IpcMode): boolean;

  /**
   * Sends a `START_RECORDING` command to the server.
   * The server's response will be delivered via `onRecording`.
   */
  startRecording(): void;

  /**
   * Sends a `STOP_RECORDING` command to the server.
   * The server's response will be delivered via `onRecording`.
   */
  stopRecording(): void;

  /**
   * Toggles the **local** audio stream on or off. If an argument is provided, it will force the state to the specified value, otherwise, the current state will be toggled.
   * @param enabled 
   */
  toggleMic(enabled?: boolean): void;

  /**
   * Toggles the **remote** audio stream on or off. If an argument is provided, it will force the state to the specified value, otherwise, the current state will be toggled.
   * @param enabled
   */
  toggleSpeaker(enabled?: boolean): void;

  /**
   * Retunes the receive jitter buffer on a live connection. Same meaning and range as the
   * `jitterBufferTarget` option.
   *
   * @param target - Milliseconds of buffering to aim for, or `null` to let the browser decide.
   */
  setJitterBufferTarget(target: number | null): void;

  /**
   * The target last asked for, not the one the browser settled on. `undefined` means none has
   * been asked for.
   */
  getJitterBufferTarget(): number | null | undefined;
}
