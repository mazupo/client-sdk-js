export interface CloudflareRoomOptions {
  /**
   * The worker's API URL, e.g. `https://api.mazupo.com/cloudflare`. The access token comes from
   * `POST {apiUrl}/token`.
   */
  apiUrl: string;

  /** The worker's viewer public key. */
  apiKey: string;

  /** The room to watch. */
  roomId: string;

  /**
   * Who this viewer is in the room. A random UUID by default. Connecting again with the same id
   * within 30 s resumes the subscriptions, e.g. after a page reload.
   */
  viewerId?: string;

  /**
   * Open each live device's `_lossy` and `_reliable` channels: receive its IPC messages, and take
   * control of it to send. Fixed for the connection.
   */
  ipc?: boolean;

  /**
   * How much media the receive jitter buffer should hold, in milliseconds (`0`-`4000`).
   * Lower means less playout delay but less room to ride out jitter and recover lost packets.
   */
  jitterBufferTarget?: number | null;
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
  /**
   * The device's video and audio, once subscribed. A new MediaStream only when its tracks change,
   * so it can go straight into `video.srcObject`.
   */
  stream?: MediaStream;
  /**
   * Why the device is not playing, e.g. `wake_timeout` from the device, or `viewer_limit` when
   * the worker refused this viewer for this publication.
   */
  error?: string;
  /** The device is live with `_lossy` and `_reliable`. */
  ipc: boolean;
  control: RoomControl;
  /** This viewer controls the device and its `_reliable` channel is open. */
  canSend: boolean;
}

/**
 * - `connecting`: getting a token and joining.
 * - `joined`: in the room.
 * - `reconnecting`: the socket dropped; trying again.
 * - `closed`: after `leave()`, or when another connection took this viewer id.
 */
export type RoomStatus = 'connecting' | 'joined' | 'reconnecting' | 'closed';

export interface RoomError {
  /**
   * The worker's error code in lower case, e.g. `not_controller`. The SDK adds `token` (the token
   * request failed) and `replaced` (another connection joined with this viewer id).
   */
  code: string;
  message: string;
  /** The device the error is about, if any. */
  deviceId?: string;
}
