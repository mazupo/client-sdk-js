import { GamepadSampler } from '../gamepad/sampler';
import { IpcMode, IpcOptions } from '../peer/rtc-peer';
import { generateRequestId } from '../utils/rtc-tools';
import { Connection } from './connection';
import { RoomGamepadOptions, SfuRoomOptions } from './types';

/** What a room says about each device. */
export interface SfuRoomDevice {
  deviceId: string;
  /** Its video and audio, once they arrive. */
  stream?: MediaStream;
}

/** What a room says about each viewer. */
export interface SfuRoomViewer {
  viewerId: string;
  /** This viewer. */
  me: boolean;
}

/**
 * A room on an SFU, shared by devices and viewers: `LiveKitRoom` and `CloudflareRoom`. Besides
 * what every connection has, it lists who is in the room and can send to one device.
 */
export abstract class SfuRoom<D extends SfuRoomDevice, V extends SfuRoomViewer> extends Connection {
  /** The devices in the room. Called with the whole list after every change. */
  onDevices?: (devices: D[]) => void;
  /** Who is in the room, this viewer included. Called with the whole list after every change. */
  onViewers?: (viewers: V[]) => void;

  readonly roomId: string;
  readonly viewerId: string;

  protected constructor(options: SfuRoomOptions, defaults: { timeout: number; isMicOn: boolean }) {
    super(options, defaults);
    if (!options.roomId) {
      throw new Error(`${new.target.name} needs a roomId.`);
    }
    this.roomId = options.roomId;
    this.viewerId = options.viewerId?.trim() || generateRequestId();
  }

  /** The devices in the room, as `onDevices` last reported them. */
  abstract get devices(): D[];

  /** The viewers in the room, as `onViewers` last reported them. */
  abstract get viewers(): V[];

  /** Sends text to one device. False if it cannot reach it now. */
  sendTextTo(deviceId: string, text: string, mode: IpcMode = 'reliable'): boolean {
    return this.sendDataTo(deviceId, new TextEncoder().encode(text), mode);
  }

  /**
   * Sends bytes to one device. False if it cannot reach it now. With `options`, to an IPC
   * endpoint on it, as `sendToEndpoint()` does.
   */
  sendDataTo(deviceId: string, data: Uint8Array, mode: IpcMode = 'reliable', options?: IpcOptions): boolean {
    return this.deliver(data, mode, options, [deviceId]);
  }

  /** Whether a message sent to this device right now would reach it. */
  canSendTo(deviceId: string, mode: IpcMode = 'reliable'): boolean {
    return this.deliverable(mode, [deviceId]);
  }

  /**
   * Reads a gamepad and sends it where `sendText()` goes, or only to `deviceIds`. Calling it again
   * returns the same sampler; pass `deviceIds` again to change where it sends.
   */
  override gamepad(options: RoomGamepadOptions = {}): GamepadSampler {
    const { deviceIds, ...rest } = options;
    const sampler = super.gamepad(rest);
    // Before its first reading: the timer has not fired yet.
    if ('deviceIds' in options) {
      sampler.sendTo(deviceIds ? [...deviceIds] : undefined);
    }
    return sampler;
  }
}
