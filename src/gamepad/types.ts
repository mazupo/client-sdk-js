import type { Connection } from '../connection/connection';

/** A snapshot of a standard-mapped gamepad. */
export interface GamepadSnapshot {
  /** -1 left, +1 right. */
  leftX: number;
  /** -1 up, +1 down. */
  leftY: number;
  rightX: number;
  rightY: number;

  /** 0 released, 1 fully pressed. */
  leftTrigger: number;
  rightTrigger: number;

  /**
   * `buttons[n].pressed` as bit n:
   *
   * ```
   * 0  A     4  LB    8  Back/View    12 D-pad up     16 Guide
   * 1  B     5  RB    9  Start/Menu   13 D-pad down
   * 2  X     6  LT    10 L3           14 D-pad left
   * 3  Y     7  RT    11 R3           15 D-pad right
   * ```
   */
  buttons: number;

  /** Whether the gamepad uses the standard mapping. */
  standardMapping: boolean;

  id: string;
  index: number;
}

/** A button going down or coming up. Not repeated while it is held. */
export interface ButtonEvent {
  /** Standard-mapping index, e.g. `Button.A`. */
  index: number;
  pressed: boolean;
}

/** Why sampling stopped. */
export type SuspendReason =
  | 'hidden'
  | 'stopped'
  | 'disconnected';

export interface GamepadSamplerOptions {
  /**
   * @internal The connection that sends the readings. Its `gamepad()` sets it; a sampler made
   * without one reads the pad without sending.
   */
  connection?: Connection | null;

  /** Samples per second. Defaults to 60. */
  hz?: number;

  /** IPC endpoint. Defaults to 'gamepad'. */
  endpoint?: string;

  /** Keep sampling while hidden. Defaults to false. */
  sampleWhileHidden?: boolean;
}
