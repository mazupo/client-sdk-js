import {
  Packet,
  QueryFileRequest,
  QueryFileType,
  Request,
  VideoMode
} from "../proto/packet";
import { CameraControlId } from "../proto/camera_control";
import { CameraControlValue } from "../constants/camera-property";
import { generateRequestId, padZero, yieldToEventLoop } from "../utils/rtc-tools";
import {
  ChannelRole,
  IpcMode,
  IpcOptions,
  ipcBody,
  ipcModeToRole,
  requestCase,
  RoleLabelMap,
  RtcPeer,
  RtcPeerConfig
} from "./rtc-peer";

/** At or under this goes flat in `Packet.raw`. Matches the device's `kStreamChunkSize`. */
const IPC_FLAT_LIMIT = 64 * 1024;

/** Kept under the flat limit so the framing around it still fits one message. */
const IPC_CHUNK_SIZE = 60 * 1024;

/** Stop queueing at this much outstanding, and resume once the channel is back under the low mark. */
const SEND_HIGH_WATER = 1024 * 1024;
const SEND_LOW_WATER = 256 * 1024;

/** Longest the chunk loop may hold the main thread before handing it back. */
const SEND_SLICE_MS = 5;

/** Resolves when the channel's queue has drained, or when the channel goes away. */
function drained(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold = SEND_LOW_WATER;
    const done = () => {
      channel.removeEventListener('bufferedamountlow', done);
      channel.removeEventListener('close', done);
      channel.removeEventListener('error', done);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', done);
    channel.addEventListener('close', done);
    channel.addEventListener('error', done);
  });
}

export class CommanderPeer extends RtcPeer {
  private primaryKey?: string;
  private firstCameraClaimed = false;

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

    super.close();
    console.debug("CommanderPeer is closed.");
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
    const role = ipcModeToRole(mode);

    if (binary.length <= IPC_FLAT_LIMIT) {
      this.sendOn(role, Packet.encode(Packet.create(ipcBody(binary, options))).finish());
      return;
    }

    // One dropped chunk strands the whole body, so an oversized payload is refused on lossy
    // rather than silently mangled.
    if (mode === 'lossy') {
      console.warn(
        `Refusing to send ${binary.length} bytes on the lossy IPC channel; ` +
        `payloads over ${IPC_FLAT_LIMIT} bytes must use 'reliable'.`
      );
      return;
    }

    if (options?.endpoint) {
      console.warn(
        `Refusing to send ${binary.length} bytes to the '${options.endpoint}' IPC endpoint; ` +
        `payloads over ${IPC_FLAT_LIMIT} bytes are chunked, and a chunked body can only ` +
        `reach the default endpoint.`
      );
      return;
    }

    this.sendChunked(role, binary).catch((err) => {
      console.error("IPC stream failed:", err);
    });
  }

  /**
   * Split an oversized IPC payload into a Stream. Ordered channel only.
   *
   * A large body is both a lot of encoding and a lot of bytes to queue, so the loop hands the
   * main thread back every few milliseconds and waits whenever the channel's buffer is full.
   * Done in one pass it would block rendering and overrun the send buffer, which the browser
   * answers by throwing or tearing the channel down.
   */
  private async sendChunked(role: ChannelRole, binary: Uint8Array): Promise<void> {
    const channel = this.channel(role);
    if (channel?.readyState !== 'open') {
      console.warn(`Cannot send IPC payload: the '${RoleLabelMap[role]}' channel is not open.`);
      return;
    }

    const streamId = generateRequestId();
    const total = binary.length;

    const header = Packet.create({
      stream: { streamId, header: { totalLength: total, mimeType: "application/octet-stream" } }
    });
    if (!this.sendOn(role, Packet.encode(header).finish())) {
      return;
    }

    let deadline = performance.now() + SEND_SLICE_MS;

    for (let offset = 0; offset < total; offset += IPC_CHUNK_SIZE) {
      if (channel.bufferedAmount > SEND_HIGH_WATER) {
        await drained(channel);
        deadline = performance.now() + SEND_SLICE_MS;
      } else if (performance.now() >= deadline) {
        await yieldToEventLoop();
        deadline = performance.now() + SEND_SLICE_MS;
      }

      if (channel.readyState !== 'open') {
        console.warn(`IPC stream ${streamId} abandoned: the channel closed mid-transfer.`);
        return;
      }

      const chunk = Packet.create({
        stream: {
          streamId,
          chunk: {
            offset,
            data: binary.subarray(offset, Math.min(offset + IPC_CHUNK_SIZE, total))
          }
        }
      });
      if (!this.sendOn(role, Packet.encode(chunk).finish())) {
        return;
      }
    }

    // The device's IpcChannel completes on the trailer, not the byte count, so this is required.
    const trailer = Packet.create({ stream: { streamId, trailer: { reason: "" } } });
    this.sendOn(role, Packet.encode(trailer).finish());
  }
}
