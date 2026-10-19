import { GamepadSampler } from '../gamepad/sampler';
import { IpcMode, IpcOptions, PeerOptions, RtcPeer } from '../peer/rtc-peer';
import { clampJitterBufferTarget } from '../utils/rtc-tools';
import { ConnectionError, ConnectionOptions, ConnectionStatus, GamepadOptions } from './types';

/**
 * What every connection has, whatever carries it: `MqttCamera`, `LiveKitRoom` and
 * `CloudflareRoom`. The status, errors, IPC, gamepad, microphone, speaker and jitter buffer work
 * the same way on all three.
 */
export abstract class Connection {
  onStatus?: (status: ConnectionStatus) => void;
  /** Something went wrong. When it is why the connection gave up, `onStatus('closed')` follows. */
  onError?: (error: ConnectionError) => void;
  /** An IPC message from a device. */
  onMessage?: (data: Uint8Array, deviceId: string) => void;
  /**
   * A device's media arrived or changed. In a room `id` is the device; over MQTT it is the
   * stream's id, as one device can send more than one camera.
   */
  onStream?: (stream: MediaStream, id: string) => void;

  private currentStatus: ConnectionStatus = 'closed';
  private connectTimer?: ReturnType<typeof setTimeout>;
  private readonly timeout: number;
  private micOn: boolean;
  private speakerOn: boolean;
  private jitterBufferTarget?: number | null;
  private sampler?: GamepadSampler;

  protected constructor(options: ConnectionOptions, defaults: { timeout: number; isMicOn: boolean }) {
    this.timeout = options.timeout ?? defaults.timeout;
    this.micOn = options.isMicOn ?? defaults.isMicOn;
    this.speakerOn = options.isSpeakerOn ?? true;
    if (options.jitterBufferTarget !== undefined) {
      this.jitterBufferTarget = clampJitterBufferTarget(options.jitterBufferTarget);
    }
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  get isMicOn(): boolean {
    return this.micOn;
  }

  get isSpeakerOn(): boolean {
    return this.speakerOn;
  }

  /** Starts connecting. A closed connection can connect again. */
  connect(): void {
    if (this.currentStatus !== 'closed') {
      console.warn(`${this.constructor.name} is already connected or connecting; ignoring connect().`);
      return;
    }
    this.setStatus('connecting');
    if (this.timeout > 0) {
      this.connectTimer = setTimeout(() => {
        this.connectTimer = undefined;
        if (this.currentStatus !== 'connected') {
          this.fail({ code: 'timeout', message: `Not connected within ${this.timeout} ms.` });
        }
      }, this.timeout);
    }
    this.open();
  }

  /** Closes everything. The gamepad stops sending; `gamepad()` starts it again. */
  disconnect(): void {
    if (this.currentStatus === 'closed') {
      return;
    }
    this.close();
    this.closed();
  }

  /** Sends text to the device's IPC socket. In a room, to every device `canSend()` counts. False if it went nowhere. */
  sendText(text: string, mode: IpcMode = 'reliable'): boolean {
    return this.sendData(new TextEncoder().encode(text), mode);
  }

  /** Sends bytes to the device's IPC socket. In a room, to every device `canSend()` counts. False if it went nowhere. */
  sendData(data: Uint8Array, mode: IpcMode = 'reliable'): boolean {
    return this.deliver(data, mode);
  }

  /** Whether `sendText()` or `sendData()` would reach a device right now. */
  canSend(mode: IpcMode = 'reliable'): boolean {
    return this.deliverable(mode);
  }

  /** @internal Addressed send, for whatever encodes for a named endpoint. */
  sendToEndpoint(data: Uint8Array, mode: IpcMode = 'reliable', options?: IpcOptions): boolean {
    return this.deliver(data, mode, options);
  }

  /**
   * Reads a gamepad and sends it to the device, 60 times a second by default. Readings taken
   * while nothing can be sent are dropped, so it can start before `connect()`. A connection has
   * one gamepad: calling this again returns the same sampler, started.
   */
  gamepad(options: GamepadOptions = {}): GamepadSampler {
    this.sampler ??= new GamepadSampler({ ...options, connection: this });
    this.sampler.start();
    return this.sampler;
  }

  /** Mutes or unmutes this viewer's microphone. Without an argument, flips it. */
  toggleMic(enabled: boolean = !this.micOn): void {
    this.micOn = enabled;
    this.peers().forEach((peer) => peer.toggleMic(enabled));
  }

  /** Plays or silences everything received. Without an argument, flips it. */
  toggleSpeaker(enabled: boolean = !this.speakerOn): void {
    this.speakerOn = enabled;
    this.peers().forEach((peer) => peer.toggleSpeaker(enabled));
  }

  /**
   * The browser's `RTCStatsReport` for the receiving PeerConnection, where `inbound-rtp` reports
   * the jitter buffer, freezes and packet loss. `undefined` before there is one.
   */
  getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined {
    return this.receivingPeer()?.getStats(selector);
  }

  /** Retunes the jitter buffer of every track received. Same meaning as the option. */
  setJitterBufferTarget(target: number | null): void {
    this.jitterBufferTarget = clampJitterBufferTarget(target);
    this.peers().forEach((peer) => peer.setJitterBufferTarget(target));
  }

  /** The target last asked for, not the one the browser settled on. `undefined`: none asked for. */
  getJitterBufferTarget(): number | null | undefined {
    return this.jitterBufferTarget;
  }

  /** Opens the signaling and the peers. The status is already `connecting`. */
  protected abstract open(): void;

  /** Closes the signaling and the peers. */
  protected abstract close(): void;

  /** The PeerConnections in use, for the microphone, speaker and jitter buffer. */
  protected abstract peers(): RtcPeer[];

  /** Sends to the devices `deviceIds` names, or by default to every device `canSend()` counts. */
  protected abstract deliver(data: Uint8Array, mode: IpcMode, options?: IpcOptions, deviceIds?: string[]): boolean;

  protected abstract deliverable(mode: IpcMode, deviceIds?: string[]): boolean;

  /** The peer `getStats()` reads. */
  protected receivingPeer(): RtcPeer | undefined {
    return this.peers()[0];
  }

  /** What a new peer starts with. A fresh object: each peer keeps its own. */
  protected peerOptions(): PeerOptions {
    return { isMicOn: this.micOn, isSpeakerOn: this.speakerOn, jitterBufferTarget: this.jitterBufferTarget };
  }

  protected setStatus(status: ConnectionStatus): void {
    if (status === 'connected') {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
    if (this.currentStatus === status) {
      return;
    }
    this.currentStatus = status;
    this.onStatus?.(status);
  }

  protected emitError(error: ConnectionError): void {
    this.onError?.(error);
  }

  /** Gives up: says why, then closes. */
  protected fail(error: ConnectionError): void {
    this.emitError(error);
    this.disconnect();
  }

  /** The connection is closed already, e.g. replaced; tidies up and says so. */
  protected closed(): void {
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    this.sampler?.stop();
    this.setStatus('closed');
  }
}
