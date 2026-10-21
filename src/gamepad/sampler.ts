import type { Connection } from '../connection/connection';
import type { SfuRoom, SfuRoomDevice, SfuRoomViewer } from '../connection/sfu-room';
import { InputReport } from '../proto/input';
import { toSnapshot } from './snapshot';
import {
  ButtonEvent,
  GamepadSamplerOptions,
  GamepadSnapshot,
  SuspendReason,
} from './types';

type SnapshotListener = (snapshot: GamepadSnapshot | null) => void;
type SuspendListener = (reason: SuspendReason) => void;
type ButtonListener = (event: ButtonEvent) => void;

const DEFAULT_HZ = 60;
const DEFAULT_ENDPOINT = 'gamepad';

/**
 * Polls one gamepad at a fixed rate, publishes each reading, and sends it to the device.
 *
 * On a timer rather than `requestAnimationFrame`, and stopped outright while the document is
 * hidden: the device reads a steady stream as proof the link is alive, so a rate that halves
 * on a 120 Hz monitor or dribbles on in a background tab is worse than none.
 */
export class GamepadSampler {
  private readonly hz: number;
  private readonly endpoint: string;
  private readonly sampleWhileHidden: boolean;

  private readonly connection: Connection | null;
  /** In a room: only these devices. Unset: wherever the connection's `sendText()` goes. */
  private deviceIds?: string[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private wanted = false;

  /** From 1: the device reads 0 as unsequenced. It drops anything not newer than the last. */
  private sequence = 1;

  private latest: GamepadSnapshot | null = null;
  private trackedIndex: number | null = null;
  private warnedNonStandard = false;

  /** The button bits as they were last reported, to diff the next reading against. */
  private lastButtons = 0;

  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly suspendListeners = new Set<SuspendListener>();
  private readonly buttonListeners = new Set<ButtonListener>();

  constructor(options: GamepadSamplerOptions = {}) {
    this.connection = options.connection ?? null;
    this.hz = options.hz && options.hz > 0 ? options.hz : DEFAULT_HZ;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.sampleWhileHidden = options.sampleWhileHidden ?? false;
  }

  /** The most recent reading, or null when no pad is connected. */
  get snapshot(): GamepadSnapshot | null {
    return this.latest;
  }

  /** Whether the timer is currently running. False while suspended. */
  get sampling(): boolean {
    return this.timer !== null;
  }

  /** @internal Where a room's gamepad goes; `room.gamepad({ deviceIds })` sets it. */
  sendTo(deviceIds: string[] | undefined): void {
    this.deviceIds = deviceIds;
  }

  /** Called with each reading, and with null when the pad goes away. */
  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  /** Called when sampling stops, with why. */
  onSuspend(listener: SuspendListener): () => void {
    this.suspendListeners.add(listener);
    return () => this.suspendListeners.delete(listener);
  }

  /** Called once each time any button changes, never while one is held. */
  onButtonChange(listener: ButtonListener): () => void {
    this.buttonListeners.add(listener);
    return () => this.buttonListeners.delete(listener);
  }

  /**
   * Called once each time a specific button changes.
   *
   * ```ts
   * sampler.onButton(Button.A, (pressed) => { if (pressed) fire(); });
   * ```
   */
  onButton(index: number, listener: (pressed: boolean) => void): () => void {
    return this.onButtonChange((event) => {
      if (event.index === index) {
        listener(event.pressed);
      }
    });
  }

  start(): void {
    if (this.wanted) {
      return;
    }
    this.wanted = true;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepaddisconnected', this.handleDisconnect);
    }

    this.resume();
  }

  stop(): void {
    if (!this.wanted) {
      return;
    }
    this.wanted = false;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepaddisconnected', this.handleDisconnect);
    }

    this.pause('stopped');
    this.latest = null;
    this.trackedIndex = null;
    this.releaseHeldButtons();
    this.emitSnapshot(null);
  }

  // --- internals ------------------------------------------------------------

  private resume(): void {
    // One timer however many times we are asked: two loops would send twice over.
    if (this.timer !== null || !this.wanted) {
      return;
    }
    if (!this.sampleWhileHidden && typeof document !== 'undefined'
      && document.visibilityState === 'hidden') {
      return;
    }
    this.timer = setInterval(this.tick, Math.round(1000 / this.hz));
  }

  private pause(reason: SuspendReason): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.suspendListeners.forEach((listener) => listener(reason));
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      if (!this.sampleWhileHidden) {
        this.pause('hidden');
      }
    } else {
      this.resume();
    }
  };

  private handleDisconnect = (event: Event): void => {
    const disconnected = (event as GamepadEvent).gamepad;
    if (this.trackedIndex !== null && disconnected?.index === this.trackedIndex) {
      this.trackedIndex = null;
      this.latest = null;
      this.releaseHeldButtons();
      this.emitSnapshot(null);
      this.suspendListeners.forEach((listener) => listener('disconnected'));
    }
  };

  /** The pad being followed if it is still there, otherwise the first one that is. */
  private pick(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return null;
    }
    const pads = navigator.getGamepads();
    if (this.trackedIndex !== null) {
      const tracked = pads[this.trackedIndex];
      if (tracked && tracked.connected) {
        return tracked;
      }
    }
    for (const pad of pads) {
      if (pad && pad.connected) {
        this.trackedIndex = pad.index;
        return pad;
      }
    }
    this.trackedIndex = null;
    return null;
  }

  private tick = (): void => {
    const pad = this.pick();
    if (!pad) {
      if (this.latest !== null) {
        this.latest = null;
        this.releaseHeldButtons();
        this.emitSnapshot(null);
      }
      return;
    }

    const snapshot = toSnapshot(pad);
    this.latest = snapshot;
    // Before sending: local behaviour should not depend on there being a connection.
    this.emitButtonChanges(snapshot.buttons);
    this.emitSnapshot(snapshot);

    if (!this.connection) {
      return;
    }

    if (!snapshot.standardMapping) {
      // Its fields hold whatever this pad put there, not what their names say. Once, not 60/s.
      if (!this.warnedNonStandard) {
        this.warnedNonStandard = true;
        console.warn(
          `Not sending input from "${snapshot.id}": the browser could not place it in the ` +
          `standard gamepad mapping, so its axes and buttons cannot be read reliably.`,
        );
      }
      return;
    }

    // Always lossy: a late reading is worse than a lost one, and the next comes within 1/hz.
    const options = { endpoint: this.endpoint, sequence: this.sequence };
    if (this.deviceIds) {
      // Set only by a room's gamepad().
      const room = this.connection as SfuRoom<SfuRoomDevice, SfuRoomViewer>;
      const targets = this.deviceIds.filter((deviceId) => room.canSendTo(deviceId, 'lossy'));
      if (targets.length === 0) {
        return;
      }
      const data = this.encode(snapshot);
      targets.forEach((deviceId) => room.sendDataTo(deviceId, data, 'lossy', options));
    } else {
      if (!this.connection.canSend('lossy')) {
        return;
      }
      this.connection.sendToEndpoint(this.encode(snapshot), 'lossy', options);
    }
    this.sequence++;
  };

  private encode(snapshot: GamepadSnapshot): Uint8Array {
    return InputReport.encode(
      InputReport.create({
        sequence: this.sequence,
        // Monotonic: a wall clock can step mid-flight.
        timestamp: { monotonicNs: Math.round(performance.now() * 1_000_000) },
        gamepad: {
          leftX: snapshot.leftX,
          leftY: snapshot.leftY,
          rightX: snapshot.rightX,
          rightY: snapshot.rightY,
          leftTrigger: snapshot.leftTrigger,
          rightTrigger: snapshot.rightTrigger,
          buttons: snapshot.buttons,
          standardMapping: snapshot.standardMapping,
        },
      }),
    ).finish();
  }

  private emitSnapshot(snapshot: GamepadSnapshot | null): void {
    this.snapshotListeners.forEach((listener) => listener(snapshot));
  }

  /** One event per bit that differs from the last reading, so a held button fires once. */
  private emitButtonChanges(buttons: number): void {
    const changed = (this.lastButtons ^ buttons) >>> 0;
    this.lastButtons = buttons;
    if (changed === 0 || this.buttonListeners.size === 0) {
      return;
    }
    for (let index = 0; index < 32; index++) {
      const bit = (1 << index) >>> 0;
      if ((changed & bit) !== 0) {
        const event: ButtonEvent = { index, pressed: (buttons & bit) !== 0 };
        this.buttonListeners.forEach((listener) => listener(event));
      }
    }
  }

  private releaseHeldButtons(): void {
    this.emitButtonChanges(0);
  }
}
