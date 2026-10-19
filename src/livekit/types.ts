import type { SfuRoomOptions } from '../connection/types';
import type { Participant } from '../signaling/livekit-client';

export type { Participant, Quality, RoomInfo, Speaking } from '../signaling/livekit-client';

export interface LiveKitRoomOptions extends SfuRoomOptions {
  /**
   * The LiveKit relay to dial, e.g. `wss://api.mazupo.com`. Matches
   * pi-webrtc's `--livekit-url`.
   */
  url: string;

  /**
   * Matches pi-webrtc's `--livekit-key`. Issued by LiveKit; the relay compares it against its
   * own LIVEKIT_API_KEY before it mints an access token.
   */
  apiKey: string;
}

export type LiveKitParticipantState = Participant['state'];

/** A participant whose video arrives: a device. */
export interface LiveKitDevice {
  /** Its LiveKit identity: the device's `--uid`. */
  deviceId: string;
  sid: string;
  state: LiveKitParticipantState;
  stream?: MediaStream;
}

/** A participant without video, or this viewer. */
export interface LiveKitViewer {
  /** Its LiveKit identity. */
  viewerId: string;
  /** Unset for this viewer: LiveKit lists only the others. */
  sid?: string;
  state?: LiveKitParticipantState;
  me: boolean;
}
