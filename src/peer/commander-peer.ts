import {
  Packet,
  QueryFileRequest,
  QueryFileResponse,
  QueryFileType,
  RecordingResponse,
  Request,
  VideoMode
} from "../proto/packet";
import { CameraControlId } from "../proto/camera_control";
import { CameraControlValue } from "../constants/camera-property";
import { StreamAssembler, StreamResult } from "../rtc/datachannel-receiver";
import { sendIpc } from "../rtc/ipc-sender";
import { arrayBufferToBase64, generateRequestId, padZero } from "../utils/rtc-tools";
import {
  ChannelRole,
  IpcMode,
  IpcOptions,
  ipcModeToRole,
  RequestType,
  requestCase,
  RtcPeer,
  RtcPeerConfig
} from "./rtc-peer";

interface PendingRequest {
  type: RequestType;
  createdAt: number;
}

/**
 * The direct peer to one device over MQTT signaling. Besides media and IPC it has the `command`
 * and `stream` channels: snapshots, recording, recorded files and camera controls.
 */
export class CommanderPeer extends RtcPeer {
  onSnapshot?: (base64: string) => void;
  onVideoListLoaded?: (res: QueryFileResponse) => void;
  onVideoDownloaded?: (file: Uint8Array) => void;
  onRecording?: (res: RecordingResponse) => void;

  private primaryKey?: string;
  private firstCameraClaimed = false;
  private streamAssembler?: StreamAssembler;

  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly MAX_PENDING_REQUESTS = 256;
  private readonly PENDING_REQUEST_TTL_MS = 5 * 60 * 1000;

  constructor(config: RtcPeerConfig) {
    super(config);

    if (!this.options.datachannelOnly) {
      console.debug("Create CommanderPeer with video/audio transceiver.");
      this.createlocalAudioStream();
      this.peer.addTransceiver("video", { direction: "recvonly" });
      this.peer.addTransceiver("audio", { direction: "sendrecv" });
    }

    // All four are negotiated out-of-band, so both sides open them locally on matching ids. The
    // IPC pair is unconditional: the client cannot know whether the device has `--enable-ipc`.
    this.createNegotiatedChannel(ChannelRole.Command);
    this.createNegotiatedChannel(ChannelRole.Stream);
    this.createNegotiatedChannel(ChannelRole.Lossy);
    this.createNegotiatedChannel(ChannelRole.Reliable);

    console.debug("CommanderPeer is created.");
  }

  protected override getStreamKey(event: RTCTrackEvent): string {
    const streamId = super.getStreamKey(event);

    if (event.track.kind === 'audio') {
      return this.primaryKey ??= streamId;
    }
    if (!this.firstCameraClaimed) {
      this.firstCameraClaimed = true;
      return this.primaryKey ??= streamId;
    }
    return streamId;
  }

  close = () => {
    this.primaryKey = undefined;
    this.firstCameraClaimed = false;

    if (this.isChannelOpen(ChannelRole.Command)) {
      const packet = Packet.create({
        requestId: generateRequestId(),
        request: Request.create({ disconnect: { reason: 1 } })
      });
      this.sendOn(ChannelRole.Command, Packet.encode(packet).finish());
    }

    this.streamAssembler?.reset();
    this.streamAssembler = undefined;
    this.pendingRequests.clear();
    this.onSnapshot = undefined;
    this.onVideoListLoaded = undefined;
    this.onVideoDownloaded = undefined;
    this.onRecording = undefined;

    super.close();
    console.debug("CommanderPeer is closed.");
  }

  /** Apply codec preferences to every video transceiver before each description. */
  protected override prepareNegotiation(): void {
    this.peer.getTransceivers()
      .filter((transceiver) =>
        transceiver.receiver.track?.kind === "video" && transceiver.currentDirection !== "stopped")
      .forEach((transceiver) => this.preferCodec(transceiver));
  }

  private isCodec(entry: { mimeType: string }, name: string): boolean {
    return entry.mimeType.split("/")[1]?.toUpperCase() === name.toUpperCase();
  }

  /** Restrict the video m-line to the selected codec before generating the description. */
  private preferCodec(transceiver: RTCRtpTransceiver): void {
    const codec = this.options.codec;
    if (!codec) {
      return;
    }

    const capabilities = RTCRtpReceiver.getCapabilities("video");
    if (!capabilities) {
      console.warn("Cannot read video capabilities; leaving the codec preference alone.");
      return;
    }

    // Keep RTX, RED, and ULPFEC alongside the selected codec.
    const wanted = capabilities.codecs.filter((entry) =>
      this.isCodec(entry, codec) || this.isCodec(entry, "RTX")
      || this.isCodec(entry, "RED") || this.isCodec(entry, "ULPFEC"));

    if (!wanted.some((entry) => this.isCodec(entry, codec))) {
      console.warn(`This browser cannot receive ${codec}; leaving the codec preference alone.`);
      return;
    }

    // Don't select a codec the remote isn't sending.
    const offered = transceiver.receiver.getParameters?.()?.codecs ?? [];
    if (offered.length > 0 && !offered.some((entry) => this.isCodec(entry, codec))) {
      console.debug(`The remote is not sending ${codec} here; leaving the codec preference alone.`);
      return;
    }

    try {
      transceiver.setCodecPreferences(wanted);
    } catch (err) {
      // Never let a codec preference take the whole negotiation down with it.
      console.warn("Failed to set the codec preference:", err);
    }
  }

  /**
   * Record an outgoing request so its answer can be recognised. Nothing on a stream says what its
   * body is, so this map is what decides how a completed body is parsed.
   */
  private trackRequest(type: RequestType): string {
    this.prunePendingRequests();
    const requestId = generateRequestId();
    this.pendingRequests.set(requestId, { type, createdAt: Date.now() });
    return requestId;
  }

  private retireRequest(requestId: string): RequestType | undefined {
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

  /** `stream` carries chunked answers; `command` answers are read inline. */
  protected override createReceivers(role: ChannelRole): void {
    if (role !== ChannelRole.Stream) {
      super.createReceivers(role);
      return;
    }
    this.streamAssembler?.reset();
    this.streamAssembler = new StreamAssembler({
      onProgress: (received, total, requestId) => {
        const type = this.pendingRequests.get(requestId)?.type;
        if (type !== undefined) {
          this.onProgress?.(received, total, type, requestId || undefined);
        }
      },
      onComplete: (result) => this.handleStreamComplete(result),
      onAbort: (_streamId, _reason, requestId) => this.retireRequest(requestId),
    });
  }

  protected override dispatchPayload(role: ChannelRole, data: Uint8Array) {
    if (role === ChannelRole.Command) {
      this.dispatchResponse(Packet.decode(data));
    } else if (role === ChannelRole.Stream) {
      this.streamAssembler?.receive(Packet.decode(data));
    } else {
      super.dispatchPayload(role, data);
    }
  }

  /**
   * Route a reassembled body by the request it answers, falling back to the device's mime type
   * hint if that request has already been retired.
   */
  private handleStreamComplete(result: StreamResult): void {
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

  /** The pending entry is what later parses the answer, so it is recorded before sending. */
  private sendRequest(request: Request): void {
    const type = requestCase(request);
    if (!type) {
      console.warn("Refusing to send a request without exactly one payload set.");
      return;
    }

    const requestId = this.trackRequest(type);
    const packet = Packet.create({ requestId, request });
    if (!this.sendOn(ChannelRole.Command, Packet.encode(packet).finish())) {
      this.retireRequest(requestId);
    }
  }

  fetchVideoList = (options?: { param?: string | Date, mode?: VideoMode }) => {
    const { param, mode } = options ?? {};

    if (!this.onVideoListLoaded) {
      return;
    }

    let queryFile = QueryFileRequest.create();

    if (mode !== undefined) {
      queryFile.mode = mode;
    }

    if (param === undefined) {
      queryFile.type = QueryFileType.LATEST_FILE;
    } else if (typeof param === "string") {
      queryFile.type = QueryFileType.BEFORE_FILE;
      queryFile.parameter = param;
    } else {
      const formattedDate = `${param.getFullYear()}${padZero(param.getMonth() + 1)}${padZero(param.getDate())}` +
        "_" + `${padZero(param.getHours())}${padZero(param.getMinutes())}${padZero(param.getSeconds())}`;
      queryFile.type = QueryFileType.BEFORE_TIME;
      queryFile.parameter = formattedDate;
    }

    this.sendRequest(Request.create({ queryFile }));
  }

  downloadVideoFile = (path: string) => {
    if (!this.onVideoDownloaded) {
      return;
    }
    this.sendRequest(Request.create({ transferFile: { filepath: path } }));
  }

  setCameraControl = (key: CameraControlId, value: CameraControlValue) => {
    this.sendRequest(Request.create({ controlCamera: { id: key, value: value } }));
  }

  snapshot = (quality: number = 30) => {
    if (!this.onSnapshot) {
      return;
    }
    this.sendRequest(Request.create({ takeSnapshot: { quality: Math.max(0, Math.min(quality, 100)) } }));
  }

  // No arguments, but each still needs its empty message: the arm that is set is what
  // identifies them.
  startRecording = () => {
    this.sendRequest(Request.create({ startRecording: {} }));
  }

  stopRecording = () => {
    this.sendRequest(Request.create({ stopRecording: {} }));
  }

  sendText = (msg: string, mode: IpcMode = 'reliable') => {
    this.sendData(new TextEncoder().encode(msg), mode);
  }

  sendData = (binary: Uint8Array, mode: IpcMode = 'reliable') => {
    this.sendToEndpoint(binary, mode);
  }

  /** @internal Addressed send, for whatever encodes for a named endpoint. */
  sendToEndpoint = (binary: Uint8Array, mode: IpcMode = 'reliable', options?: IpcOptions) => {
    sendIpc(this.channel(ipcModeToRole(mode)), binary, mode, options);
  }
}
