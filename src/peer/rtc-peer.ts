import { PiCameraOptions } from "../pi-camera.types";
import { Packet, QueryFileResponse, RecordingResponse, Request } from "../proto/packet";
import { StreamAssembler, StreamResult } from "../rtc/datachannel-receiver";
import { arrayBufferToBase64, generateRequestId, yieldToEventLoop } from "../utils/rtc-tools";

export type ChannelLabel = 'command' | 'stream' | '_lossy' | '_reliable';

/**
 * What a channel is *for*. A direct peer (MQTT, WHEP) negotiates all four out-of-band on the ids
 * in `RoleIdMap`, so `ondatachannel` never fires; over LiveKit the SFU opens its own by label.
 */
export enum ChannelRole {
  Command,
  Stream,
  Lossy,
  Reliable
};

export const RoleLabelMap: Record<ChannelRole, ChannelLabel> = {
  [ChannelRole.Command]: 'command',
  [ChannelRole.Stream]: 'stream',
  [ChannelRole.Lossy]: '_lossy',
  [ChannelRole.Reliable]: '_reliable'
};

export const LabelToRoleMap: Record<ChannelLabel, ChannelRole> = {
  'command': ChannelRole.Command,
  'stream': ChannelRole.Stream,
  '_lossy': ChannelRole.Lossy,
  '_reliable': ChannelRole.Reliable
};

/** Must match the device's `RoleId`. */
export const RoleIdMap: Record<ChannelRole, number> = {
  [ChannelRole.Command]: 0,
  [ChannelRole.Stream]: 1,
  [ChannelRole.Lossy]: 2,
  [ChannelRole.Reliable]: 3
};

/** Must match the device's `RoleInit`. */
export function roleInit(role: ChannelRole): RTCDataChannelInit {
  switch (role) {
    case ChannelRole.Command:
    case ChannelRole.Reliable:
      return { ordered: true };
    case ChannelRole.Stream:
      return { ordered: false };
    case ChannelRole.Lossy:
      return { ordered: false, maxRetransmits: 0 };
  }
}

/**
 * Which arm of `Request.payload` is set — the device's `Request::PayloadCase`. protoc generates
 * that enum for C++; ts-proto generates no equivalent, so it is named here. The values are the
 * generated field names, which is what lets `requestCase` read one straight off a message.
 */
export enum RequestType {
  Disconnect = 'disconnect',
  ControlCamera = 'controlCamera',
  TakeSnapshot = 'takeSnapshot',
  QueryFile = 'queryFile',
  TransferFile = 'transferFile',
  ToggleTracking = 'toggleTracking',
  StartRecording = 'startRecording',
  StopRecording = 'stopRecording',
  /** Not an arm of the oneof: an unprompted IPC payload. */
  Ipc = 'ipc'
}

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** Fails to compile if the proto gains, drops or renames a request arm. */
const _coversEveryRequestArm: Exact<Exclude<`${RequestType}`, 'ipc'>, keyof Request> = true;
void _coversEveryRequestArm;

/**
 * The arm that is set, equivalent to `Request::payload_case()` on the device. Undefined unless
 * exactly one is: ts-proto renders a oneof as plain optional fields, so nothing stops a caller
 * setting two, and both would go on the wire for the device to resolve as it saw fit.
 */
export function requestCase(request: Request): RequestType | undefined {
  const set = (Object.keys(request) as (keyof Request)[])
    .filter((name) => request[name] !== undefined);

  if (set.length > 1) {
    console.warn(`Request has more than one payload set: ${set.join(', ')}.`);
    return undefined;
  }
  return set[0] as RequestType | undefined;
}

/** Which IPC channel a message goes out on. Per message, not a connection-time setting. */
export type IpcMode = 'lossy' | 'reliable';

export function ipcModeToRole(mode: IpcMode): ChannelRole {
  return mode === 'lossy' ? ChannelRole.Lossy : ChannelRole.Reliable;
}

/**
 * @internal Addressing for `sendToEndpoint`.
 */
export interface IpcOptions {
  /** Endpoint name. `''` is the device's default socket; `'gamepad'` is operator input. */
  endpoint?: string;
  sequence?: number;
}

/** A destination for encoded IPC payloads. */
export interface IpcSink {
  sendToEndpoint(data: Uint8Array, mode?: IpcMode, options?: IpcOptions): void;
  canSend?(mode?: IpcMode): boolean;
}

/** `Ipc` carries an endpoint; without options this is `raw`, which reaches the default socket. */
export function ipcBody(binary: Uint8Array, options?: IpcOptions) {
  return options
    ? {
      ipc: {
        endpoint: options.endpoint ?? '',
        sequence: options.sequence ?? 0,
        payload: binary,
      }
    }
    : { raw: binary };
}

export interface RtcPeerConfig extends RTCConfiguration {
  options: PiCameraOptions;
}

interface PendingRequest {
  type: RequestType;
  createdAt: number;
}

export class RtcPeer {
  onSnapshot?: (base64: string) => void;
  onVideoListLoaded?: (res: QueryFileResponse) => void;
  onProgress?: (received: number, total: number, type: RequestType, requestId?: string) => void;
  onVideoDownloaded?: (file: Uint8Array) => void;
  onDatachannel?: (role: ChannelRole) => void;
  onMessage?: (data: Uint8Array) => void;
  onRecording?: (res: RecordingResponse) => void;
  onStream?: (stream: MediaStream) => void;
  onSfuStream?: (sid: string, stream: MediaStream) => void;
  onIceCandidate?: ((ev: RTCPeerConnectionIceEvent) => any);
  onConnectionStateChange?: ((ev: RTCPeerConnectionState) => any);
  onOffer?: ((offer: RTCSessionDescriptionInit) => any);
  onAnswer?: ((answer: RTCSessionDescriptionInit) => any);
  onReconnectFailed?: (() => any);

  readonly options: PiCameraOptions;
  protected peer: RTCPeerConnection;
  protected channels: Partial<Record<ChannelRole, RTCDataChannel>> = {};
  private localStream?: MediaStream;
  private remoteStreamMap: Map<string, MediaStream> = new Map();
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private assemblers: Partial<Record<ChannelRole, StreamAssembler>> = {};
  private messageQueue: Array<{ role: ChannelRole; buffer: ArrayBuffer }> = [];
  private messageQueueHead = 0;
  private isProcessingQueue = false;

  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly MAX_PENDING_REQUESTS = 256;
  private readonly PENDING_REQUEST_TTL_MS = 5 * 60 * 1000;

  private readonly MAX_ICE_RESTART_ATTEMPTS = 3;
  private readonly DISCONNECT_RESTART_DELAY_MS = 3000;
  private readonly ICE_RESTART_TIMEOUT_MS = 8000;
  private iceRestartAttempts = 0;
  private reconnectFailed = false;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private iceRestartTimer?: ReturnType<typeof setTimeout>;
  private negotiationReady = false;

  constructor(config: RtcPeerConfig) {
    this.options = config.options;
    this.peer = new RTCPeerConnection(config);
    this.peer.ontrack = (event) => this.handleTrack(event);
    this.peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate?.(event);
      }
    }
    this.peer.onconnectionstatechange = () => {
      const state = this.peer.connectionState;
      this.onConnectionStateChange?.(state);

      if (state === "connected") {
        this.clearDisconnectTimer();
        this.clearIceRestartTimer();
        this.iceRestartAttempts = 0;
        this.reconnectFailed = false;
        this.negotiationReady = true;
      } else if (state === "failed") {
        this.clearDisconnectTimer();
        this.tryRestartIce();
      } else if (state === "disconnected") {
        this.clearDisconnectTimer();
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = undefined;
          const currentState = this.peer.connectionState;
          if (currentState === "disconnected" || currentState === "failed") {
            this.tryRestartIce();
          }
        }, this.DISCONNECT_RESTART_DELAY_MS);
      }
    }

    // Only LiveKit opens channels in-band; a negotiated channel never raises this.
    this.peer.ondatachannel = (ev) => {
      const channel = ev.channel;
      const role = LabelToRoleMap[channel.label as ChannelLabel];
      if (role === undefined) {
        console.debug(`Ignoring data channel with unknown label: ${channel.label}`);
        return;
      }
      this.adoptChannel(role, channel);
    }

    this.peer.onnegotiationneeded = async () => {
      try {
        if (!this.negotiationReady) {
          console.debug("onnegotiationneeded: skipped before initial offer is sent");
          return;
        }

        if (this.peer.signalingState !== "stable") {
          console.debug("signaling state is not `stable`:", this.peer.signalingState);
          return;
        }

        console.debug("onnegotiationneeded: creating offer");
        this.createOffer();

      } catch (err) {
        console.error("Error during negotiationneeded:", err);
      }
    };

  }

  get connectionState() {
    return this.peer.connectionState;
  }

  close() {
    for (const key of Object.keys(this.assemblers)) {
      this.assemblers[Number(key) as ChannelRole]?.reset();
    }
    this.assemblers = {};

    for (const key of Object.keys(this.channels)) {
      const channel = this.channels[Number(key) as ChannelRole];
      if (channel) {
        channel.onmessage = null;
        channel.onopen = null;
        channel.close();
      }
    }
    this.channels = {};
    this.pendingRequests.clear();

    this.localStream?.getTracks().forEach(track => {
      track.stop();
    });
    this.localStream = undefined;

    this.remoteStreamMap.forEach(stream => {
      stream.getTracks().forEach(track => {
        track.stop();
      });
    });
    this.remoteStreamMap.clear();

    this.peer.close();
    this.peer.ontrack = null;
    this.peer.onicecandidate = null;
    this.peer.onconnectionstatechange = null;
    this.peer.ondatachannel = null;

    this.clearDisconnectTimer();
    this.clearIceRestartTimer();
    this.iceRestartAttempts = 0;
    this.reconnectFailed = false;
    this.negotiationReady = false;

    this.onSnapshot = undefined;
    this.onVideoListLoaded = undefined;
    this.onProgress = undefined;
    this.onVideoDownloaded = undefined;
    this.onMessage = undefined;
    this.onRecording = undefined;
    this.onStream = undefined;
    this.onIceCandidate = undefined;
    this.onConnectionStateChange = undefined;
    this.onReconnectFailed = undefined;

    this.messageQueue = [];
    this.messageQueueHead = 0;
    this.isProcessingQueue = false;
    console.debug("webrtc peer is closed.");
  }

  /** Open an out-of-band channel. Both sides create it locally on the same id. */
  protected createNegotiatedChannel(role: ChannelRole): RTCDataChannel {
    const channel = this.peer.createDataChannel(RoleLabelMap[role], {
      ...roleInit(role),
      negotiated: true,
      id: RoleIdMap[role]
    });
    this.adoptChannel(role, channel);
    return channel;
  }

  /** Open a channel in-band, for backends that negotiate through the SDP. */
  createDataChannel(role: ChannelRole, options?: RTCDataChannelInit) {
    return this.peer.createDataChannel(RoleLabelMap[role], options);
  }

  /**
   * Take ownership of a channel and announce it once usable. One handed over by `ondatachannel`
   * can already be open, so this cannot rely on `onopen` alone.
   */
  protected registerChannel(role: ChannelRole, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    this.channels[role] = channel;

    if (channel.readyState === 'open') {
      this.onDatachannel?.(role);
    } else {
      channel.onopen = () => this.onDatachannel?.(role);
    }
  }

  /** Register a channel and start reading from it. */
  protected adoptChannel(role: ChannelRole, channel: RTCDataChannel): void {
    this.registerChannel(role, channel);
    this.createReceivers(role);
    channel.onmessage = (e) => this.onDataChannelMessage(role, e);
  }

  protected channel(role: ChannelRole): RTCDataChannel | undefined {
    return this.channels[role];
  }

  protected isChannelOpen(role: ChannelRole): boolean {
    return this.channels[role]?.readyState === 'open';
  }

  /** Whether a payload sent with this mode would go out right now. */
  canSend(mode: IpcMode = 'reliable'): boolean {
    return this.isChannelOpen(ipcModeToRole(mode));
  }

  /** False if the channel is not open. */
  protected sendOn(role: ChannelRole, data: Uint8Array<ArrayBuffer>): boolean {
    const channel = this.channels[role];
    if (channel?.readyState !== 'open') {
      console.warn(`Cannot send on '${RoleLabelMap[role]}': channel is not open.`);
      return false;
    }
    channel.send(data);
    return true;
  }

  /**
   * Record an outgoing request so its answer can be recognised. Nothing on a stream says what its
   * body is, so this map is what decides how a completed body is parsed.
   */
  protected trackRequest(type: RequestType): string {
    this.prunePendingRequests();
    const requestId = generateRequestId();
    this.pendingRequests.set(requestId, { type, createdAt: Date.now() });
    return requestId;
  }

  protected retireRequest(requestId: string): RequestType | undefined {
    if (!requestId) {
      return undefined;
    }
    const pending = this.pendingRequests.get(requestId);
    this.pendingRequests.delete(requestId);
    return pending?.type;
  }

  /** Answers that never arrive would otherwise sit here for the life of the connection. */
  private prunePendingRequests(): void {
    const cutoff = Date.now() - this.PENDING_REQUEST_TTL_MS;
    for (const [id, request] of this.pendingRequests) {
      if (request.createdAt < cutoff) {
        this.pendingRequests.delete(id);
      }
    }
    while (this.pendingRequests.size >= this.MAX_PENDING_REQUESTS) {
      const oldest = this.pendingRequests.keys().next();
      if (oldest.done) {
        break;
      }
      this.pendingRequests.delete(oldest.value);
    }
  }

  createOffer = async (options?: RTCOfferOptions) => {
    const offer = await this.peer.createOffer(options);
    await this.peer.setLocalDescription(offer);
    console.debug("createOffer: ", offer);
    this.onOffer?.(offer);
  }

  createAnswer = async (sd: RTCSessionDescriptionInit) => {
    await this.setRemoteDescription(sd);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    console.debug("createAnswer: ", answer);
    return answer;
  }

  createlocalAudioStream = async () => {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false,
    });

    this.localStream.getAudioTracks().forEach(track => {
      this.peer.addTrack(track, this.localStream!);
      track.enabled = this.options.isMicOn ?? false;
    });
  }

  setRemoteDescription = async (description: RTCSessionDescriptionInit) => {
    await this.peer.setRemoteDescription(description);
    this.pendingIceCandidates.forEach(candidate => {
      this.peer.addIceCandidate(candidate);
    });
    this.pendingIceCandidates = [];
  }

  addIceCandidate = (candidate: RTCIceCandidateInit) => {
    if (!this.peer.remoteDescription && candidate) {
      this.pendingIceCandidates.push(candidate);
    } else {
      this.peer.addIceCandidate(candidate);
    }
  }

  toggleMic = (enabled: boolean = !this.options.isMicOn) => {
    this.options.isMicOn = enabled;
    this.toggleTrack(enabled, this.localStream);
  };

  toggleSpeaker = (enabled: boolean = !this.options.isSpeakerOn) => {
    this.options.isSpeakerOn = enabled;
    this.remoteStreamMap.forEach((remoteStream) => {
      this.toggleTrack(enabled, remoteStream);
    });
  };

  private toggleTrack = (isOn: boolean, stream?: MediaStream) => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = isOn;
    });
  };

  notifySignalingReconnected = (): void => {
    const state = this.peer.connectionState;
    if (state !== "disconnected" && state !== "failed") {
      return;
    }
    console.debug("Signaling reconnected, retrying ICE restart immediately.");
    this.clearDisconnectTimer();
    this.tryRestartIce();
  }

  private tryRestartIce(): void {
    if (this.reconnectFailed || this.peer.connectionState === "closed") {
      return;
    }
    if (this.iceRestartAttempts >= this.MAX_ICE_RESTART_ATTEMPTS) {
      this.reconnectFailed = true;
      console.warn(`ICE restart failed after ${this.MAX_ICE_RESTART_ATTEMPTS} attempts, giving up.`);
      this.onReconnectFailed?.();
      return;
    }
    this.iceRestartAttempts++;
    console.log(`ICE restart attempt ${this.iceRestartAttempts}/${this.MAX_ICE_RESTART_ATTEMPTS}...`);
    this.peer.restartIce();

    this.clearIceRestartTimer();
    this.iceRestartTimer = setTimeout(() => {
      this.iceRestartTimer = undefined;
      const state = this.peer.connectionState;
      if (state !== "connected" && state !== "closed") {
        this.tryRestartIce();
      }
    }, this.ICE_RESTART_TIMEOUT_MS);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer !== undefined) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = undefined;
    }
  }

  private clearIceRestartTimer(): void {
    if (this.iceRestartTimer !== undefined) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = undefined;
    }
  }

  /**
   * Which remote stream a track belongs to. Each backend groups tracks its own way.
   */
  protected getStreamKey(event: RTCTrackEvent): string {
    return event.streams[0]?.id ?? event.transceiver.mid ?? event.track.id;
  }

  private handleTrack = (event: RTCTrackEvent) => {
    const sid = this.getStreamKey(event);

    let remoteStream = this.remoteStreamMap.get(sid);

    if (!remoteStream) {
      remoteStream = new MediaStream();
      this.remoteStreamMap.set(sid, remoteStream);
    }

    // A track can arrive ungrouped, in which case it is the whole payload.
    const tracks = event.streams[0] ? event.streams[0].getTracks() : [event.track];

    // Only announce newly added tracks.
    const added = tracks.filter((track) => !remoteStream!.getTrackById(track.id));
    if (added.length === 0) {
      return;
    }

    added.forEach((track) => {
      remoteStream!.addTrack(track);
      if (track.kind === "audio") {
        track.enabled = this.options.isSpeakerOn ?? false;
      }

      console.debug(`[${sid}] get ${track.kind} tracks => label: ${track.label}, id: ${track.id}`);
    });

    this.onStream?.(remoteStream);
    this.onSfuStream?.(sid, remoteStream);
  }

  /** Only roles carrying chunked bodies get an assembler; `command` responses are read inline. */
  protected createReceivers(role: ChannelRole): void {
    if (role === ChannelRole.Command) {
      return;
    }

    const isIpc = role === ChannelRole.Lossy || role === ChannelRole.Reliable;

    this.assemblers[role] = new StreamAssembler({
      onProgress: (received, total, requestId) => {
        const type = isIpc ? RequestType.Ipc : this.pendingRequests.get(requestId)?.type;
        if (type !== undefined) {
          this.onProgress?.(received, total, type, requestId || undefined);
        }
      },
      onComplete: (result) => this.handleStreamComplete(role, result),
      onAbort: (_streamId, _reason, requestId) => this.retireRequest(requestId),
    });
  };

  /**
   * Route a reassembled body by the request it answers, falling back to the device's mime type
   * hint if that request has already been retired.
   */
  private handleStreamComplete(role: ChannelRole, result: StreamResult): void {
    if (role === ChannelRole.Lossy || role === ChannelRole.Reliable) {
      this.onMessage?.(result.body);
      return;
    }

    const type = this.retireRequest(result.requestId) ?? this.typeFromMimeType(result.mimeType);

    switch (type) {
      case RequestType.TakeSnapshot: {
        const mime = result.mimeType || "image/jpeg";
        this.onSnapshot?.(`data:${mime};base64,` + arrayBufferToBase64(result.body));
        break;
      }
      case RequestType.QueryFile:
        this.onVideoListLoaded?.(QueryFileResponse.decode(result.body));
        break;
      case RequestType.TransferFile:
        this.onVideoDownloaded?.(result.body);
        break;
      default:
        console.warn(
          `Stream ${result.streamId} answers an unknown request ` +
          `(request_id "${result.requestId}", mime "${result.mimeType}"); dropping ${result.body.length} bytes.`
        );
    }
  }

  /** Last resort when a stream outlives its pending entry. */
  private typeFromMimeType(mimeType: string): RequestType | undefined {
    switch (mimeType) {
      case "image/jpeg":
        return RequestType.TakeSnapshot;
      case "application/x-protobuf":
        return RequestType.QueryFile;
      case "application/octet-stream":
        return RequestType.TransferFile;
      default:
        return undefined;
    }
  }

  protected onDataChannelMessage(role: ChannelRole, event: MessageEvent): void {
    this.messageQueue.push({ role, buffer: event.data as ArrayBuffer });
    if (!this.isProcessingQueue) {
      this.isProcessingQueue = true;
      this.drainQueue().catch((err) => console.error("Inbound queue failed:", err));
    }
  }

  private async drainQueue(): Promise<void> {
    try {
      await yieldToEventLoop();

      let deadline = performance.now() + 5; // 5 ms budget per slice
      while (this.messageQueueHead < this.messageQueue.length) {
        const { role, buffer } = this.messageQueue[this.messageQueueHead++];

        try {
          this.dispatchPayload(role, new Uint8Array(buffer));
        } catch (err) {
          console.error("Failed to handle an inbound packet:", err);
        }

        if (performance.now() >= deadline) {
          await yieldToEventLoop();
          deadline = performance.now() + 5;
        }
      }
    } finally {
      this.messageQueue = [];
      this.messageQueueHead = 0;
      this.isProcessingQueue = false;
    }
  }

  protected dispatchPayload(role: ChannelRole, data: Uint8Array) {
    const packet = Packet.decode(data);

    switch (role) {
      case ChannelRole.Command:
        this.dispatchResponse(packet);
        return;

      case ChannelRole.Stream:
        this.assemblers[role]?.receive(packet);
        return;

      case ChannelRole.Lossy:
      case ChannelRole.Reliable:
        // A raw body fitted in one message; a larger one arrives as a stream on this channel.
        if (packet.raw !== undefined) {
          this.onMessage?.(packet.raw);
        } else {
          this.assemblers[role]?.receive(packet);
        }
        return;
    }
  }

  private dispatchResponse(packet: Packet): void {
    this.retireRequest(packet.requestId);

    const response = packet.response;
    if (!response) {
      console.debug("Ignoring a non-response packet on the command channel.");
      return;
    }

    if (response.recording) {
      this.onRecording?.(response.recording);
    }
  }
}
