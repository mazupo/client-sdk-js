import type { SfuRoomOptions } from '../connection/types';

/** Reconnecting with the same `viewerId` within 30 s resumes the subscriptions. `timeout` is `0`: keep trying. */
export interface CloudflareRoomOptions extends SfuRoomOptions {
  /** The worker's API URL, ending in `/sfu`. The token comes from `POST {apiUrl}/token`. */
  apiUrl: string;

  /** The worker's viewer public key. */
  apiKey: string;

  /** Open each live device's `_lossy` and `_reliable`, to get its messages and take control. Fixed per connection. */
  ipc?: boolean;

  /**
   * 16 or more random characters kept with `viewerId`; only it can resume this viewer.
   * By default the room keeps one in sessionStorage. Give your own in React Native.
   */
  secret?: string;
}

export type DeviceStateName = 'offline' | 'sleeping' | 'waking' | 'live' | 'unknown';

/** A viewer in a room, as the worker names it. */
export interface RoomViewer {
  room: string;
  viewerId: string;
}

/** Someone in the room, as `onViewers` reports them. */
export interface RoomViewerInfo {
  viewerId: string;
  /** Joined with `ipc`, so it may take control of devices. */
  ipc: boolean;
  /** Its connection dropped; it may come back within 30 s. */
  away: boolean;
  /** This viewer. */
  me: boolean;
  /** It publishes its microphone. */
  microphone: boolean;
  /** Its microphone is muted. */
  muted: boolean;
  /** Its voice, once it arrives. Never set for this viewer. */
  stream?: MediaStream;
}

export interface RoomControl {
  /** Who controls the device. Unset: nobody. */
  controller?: RoomViewer;
  /** Who is taking over and has to confirm. */
  handover?: RoomViewer;
  /** In order. The first one takes over next. */
  waiting: RoomViewer[];
  /** This viewer controls the device. */
  mine: boolean;
  /** This viewer is taking over. */
  takingOver: boolean;
  /** This viewer waits in line. */
  inLine: boolean;
}

/** One device in the room, as this viewer sees it. */
export interface RoomDevice {
  /** The device's `--uid`. */
  deviceId: string;
  state: DeviceStateName;
  /** Counts the device's publications. It changes when the device publishes again or restarts. */
  generation: number;
  /** Track names. Set only while live. */
  tracks: string[];
  /** The device's video and audio once subscribed. A new MediaStream only when its tracks change. */
  stream?: MediaStream;
  /** Why the device is not playing, e.g. `wake_timeout`, or `viewer_limit` for this publication. */
  error?: string;
  /** The device is live with `_lossy` and `_reliable`. */
  ipc: boolean;
  control: RoomControl;
  /** This viewer controls the device and its `_reliable` channel is open. */
  canSend: boolean;
}
