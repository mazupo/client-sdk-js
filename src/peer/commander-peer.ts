import {
  Packet,
  QueryFileRequest,
  QueryFileType,
  Request,
  VideoMode
} from "../proto/packet";
import { CameraControlId } from "../proto/camera_control";
import { CameraControlValue } from "../constants/camera-property";
import { sendIpc } from "../rtc/ipc-sender";
import { generateRequestId, padZero } from "../utils/rtc-tools";
import {
  ChannelRole,
  IpcMode,
  IpcOptions,
  ipcModeToRole,
  requestCase,
  RtcPeer,
  RtcPeerConfig
} from "./rtc-peer";

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
    sendIpc(this.channel(ipcModeToRole(mode)), binary, mode, options);
  }
}
