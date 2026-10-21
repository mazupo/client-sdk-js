import type { GamepadSamplerOptions } from '../gamepad/types';

/**
 * - `connecting`: after `connect()`, until the media path is up.
 * - `connected`: MQTT and LiveKit: the PeerConnection is connected. Cloudflare: in the room.
 * - `reconnecting`: the connection dropped; it is trying again on its own.
 * - `closed`: before `connect()`, after `disconnect()`, or after it gave up (`onError` says why).
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface ConnectionError {
  /** What went wrong, e.g. `timeout`, `reconnect_failed`, `token` or a worker code such as `not_controller`. */
  code: string;
  message: string;
  /** The device the error is about, if any. */
  deviceId?: string;
}

/** What every connection takes. */
export interface ConnectionOptions {
  /** How long `connect()` waits for `connected` before giving up with `timeout`, in ms. `0` waits forever. */
  timeout?: number;
  /** Whether the microphone starts unmuted. */
  isMicOn?: boolean;
  /** Whether received audio plays. `true` by default. */
  isSpeakerOn?: boolean;
  /**
   * How much media the receive jitter buffer should hold, in milliseconds (`0`-`4000`).
   * Lower means less playout delay but less room to ride out jitter and recover lost packets.
   */
  jitterBufferTarget?: number | null;
}

/** What LiveKitRoom and CloudflareRoom take besides their own options. */
export interface SfuRoomOptions extends ConnectionOptions {
  /** The room to join. */
  roomId: string;
  /** Who this viewer is in the room. A random UUID when omitted. */
  viewerId?: string;
  /** Talk with the other viewers: publish the microphone, muted until `toggleMic()`. `true` by default; `false` only listens. */
  microphone?: boolean;
}

/** What a gamepad sampler takes, except the connection. */
export type GamepadOptions = Omit<GamepadSamplerOptions, 'connection'>;

export interface RoomGamepadOptions extends GamepadOptions {
  /** Only these devices; by default where `sendText()` goes. Call `gamepad()` again to change them. */
  deviceIds?: string[];
}

/**
 * MediaStream extended with toURL() for React Native (react-native-webrtc).
 * When using @mazupo/client in React Native, call registerGlobals() from
 * react-native-webrtc at app startup to inject this method at runtime.
 */
export interface RNMediaStream extends MediaStream {
  toURL(): string;
}
