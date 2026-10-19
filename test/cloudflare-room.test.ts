// CloudflareRoom against a fake worker: the viewer rules a cf-sfu-worker expects, without a
// browser. fetch, WebSocket, RTCPeerConnection, MediaStream and the clock are all fakes.
//
// Build and run:
//   npx esbuild test/cloudflare-room.test.ts --bundle --platform=node --outfile=/tmp/t.cjs && node /tmp/t.cjs

import { setImmediate as realSetImmediate } from "node:timers";
import {
  CloseCode,
  DeviceInfo,
  DeviceState,
  ErrorCode,
  ViewerRequest,
  ViewerResponse,
} from "../src/proto/cloudflare";
import { Packet } from "../src/proto/packet";
import { CloudflareRoom } from "../src/cloudflare/room";
import { RoomDevice, RoomError, RoomStatus, RoomViewerInfo } from "../src/cloudflare/types";

let failures = 0;

function check(ok: boolean, what: string) {
  console.log((ok ? "  ok   " : "  FAIL ") + what);
  if (!ok) {
    failures++;
  }
}

// --- clock -----------------------------------------------------------------------------------

let now = 1_000_000;
let nextTimer = 1;
const timers: { id: number; at: number; fn: () => void }[] = [];
(globalThis as any).setTimeout = (fn: () => void, ms = 0) => {
  const id = nextTimer++;
  timers.push({ id, at: now + ms, fn });
  return id;
};
(globalThis as any).clearTimeout = (id: number) => {
  const index = timers.findIndex((timer) => timer.id === id);
  if (index >= 0) {
    timers.splice(index, 1);
  }
};
(globalThis as any).setInterval = () => 0;
(globalThis as any).clearInterval = () => undefined;
Date.now = () => now;
Math.random = () => 0;

/** Lets promise chains and handlers run. */
async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => realSetImmediate(resolve));
  }
}

/** Moves the clock, running each timer that comes due. */
async function advance(ms: number) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const timer = timers[0];
    if (!timer || timer.at > end) {
      break;
    }
    timers.shift();
    now = timer.at;
    timer.fn();
    await flush();
  }
  now = end;
  await flush();
}

// --- fetch -----------------------------------------------------------------------------------

const tokenRequests: { url: string; headers: Record<string, string>; body: any }[] = [];
let tokenStatus = 200;
(globalThis as any).fetch = async (url: string, init: any) => {
  tokenRequests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  const ok = tokenStatus === 200;
  return {
    ok,
    status: tokenStatus,
    json: async () => (ok ? { token: `token-${tokenRequests.length}`, url: "wss://worker.test/cloudflare/rtc" } : { error: { code: "unauthorized", message: "Wrong key." } }),
  };
};

// --- WebSocket -------------------------------------------------------------------------------

class Emitter {
  private listeners = new Map<string, Set<(event: any) => void>>();
  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: any) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, event: any = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      fn(event);
    }
  }
}

class FakeWebSocket extends Emitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  /** Requests the room sent, decoded. */
  sent: ViewerRequest[] = [];
  closedBy?: number;

  constructor(public url: string) {
    super();
    FakeWebSocket.all.push(this);
  }
  send(data: string | Uint8Array) {
    if (typeof data !== "string") {
      this.sent.push(ViewerRequest.decode(data));
    }
  }
  close(code = 1000) {
    this.closedBy = code;
    this.readyState = FakeWebSocket.CLOSED;
  }
  /** The worker accepts the socket. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open");
  }
  /** The worker sends a response. */
  receive(response: Parameters<typeof ViewerResponse.fromPartial>[0]) {
    const bytes = ViewerResponse.encode(ViewerResponse.fromPartial(response)).finish();
    this.dispatch("message", { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  /** The worker closes the socket. */
  drop(code: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason: "" });
  }
  /** The requests of one kind, e.g. "subscribe". */
  requests<K extends keyof ViewerRequest>(kind: K): NonNullable<ViewerRequest[K]>[] {
    return this.sent.filter((request) => request[kind] !== undefined).map((request) => request[kind]!);
  }
}
(globalThis as any).WebSocket = FakeWebSocket;

// --- WebRTC ----------------------------------------------------------------------------------

class FakeChannel extends Emitter {
  readyState: RTCDataChannelState = "connecting";
  binaryType = "blob";
  sent: Uint8Array[] = [];
  bufferedAmount = 0;
  constructor(public label: string, public init: RTCDataChannelInit) {
    super();
  }
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState !== "closed") {
      this.readyState = "closed";
      this.dispatch("close");
    }
  }
  open() {
    this.readyState = "open";
    this.dispatch("open");
  }
  receive(bytes: Uint8Array) {
    this.dispatch("message", { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
}

class FakeTrack {
  constructor(public id: string, public kind: string) {}
}

class FakePeer extends Emitter {
  static all: FakePeer[] = [];
  connectionState: RTCPeerConnectionState = "new";
  channels: FakeChannel[] = [];
  transceivers: { mid: string; receiver: { track: FakeTrack; jitterBufferTarget?: number | null } }[] = [];
  localDescription: RTCSessionDescriptionInit | null = null;
  remote: RTCSessionDescriptionInit[] = [];
  private offers = 0;
  constructor(public config: RTCConfiguration) {
    super();
    FakePeer.all.push(this);
  }
  createDataChannel(label: string, init: RTCDataChannelInit) {
    const channel = new FakeChannel(label, init);
    this.channels.push(channel);
    return channel;
  }
  async createOffer() {
    return { type: "offer", sdp: `offer-${FakePeer.all.indexOf(this)}-${++this.offers}` };
  }
  async createAnswer() {
    return { type: "answer", sdp: `answer-${FakePeer.all.indexOf(this)}` };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remote.push(description);
  }
  getTransceivers() {
    return this.transceivers;
  }
  getReceivers() {
    return this.transceivers.map((transceiver) => transceiver.receiver);
  }
  async getStats() {
    return new Map();
  }
  close() {
    this.connectionState = "closed";
  }
  /** RtcPeer listens through the on* properties, so events go to both. */
  override dispatch(type: string, event: any = {}) {
    super.dispatch(type, event);
    (this as any)[`on${type}`]?.(event);
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.dispatch("connectionstatechange");
  }
  /** The SFU's offer added a track on this mid. */
  addTrack(mid: string, kind = "video") {
    const receiver = { track: new FakeTrack(`${kind}-${mid}`, kind) };
    const transceiver = { mid, receiver };
    this.transceivers.push(transceiver);
    this.dispatch("track", { receiver, track: receiver.track, transceiver, streams: [] });
  }
  channel(label: string) {
    return this.channels.filter((channel) => channel.label === label).at(-1);
  }
}
(globalThis as any).RTCPeerConnection = FakePeer;
(globalThis as any).MediaStream = class {
  constructor(private tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
};

// --- helpers ---------------------------------------------------------------------------------

const LIVE = DeviceState.DEVICE_STATE_LIVE;
const SLEEPING = DeviceState.DEVICE_STATE_SLEEPING;

function device(deviceId: string, state: DeviceState, generation: number, extra: Partial<DeviceInfo> = {}): DeviceInfo {
  return DeviceInfo.fromPartial({
    deviceId,
    state,
    generation,
    tracks: state === LIVE ? ["video"] : [],
    ...extra,
  });
}

interface Setup {
  room: CloudflareRoom;
  ws: FakeWebSocket;
  pc: FakePeer;
  devices: () => RoomDevice[];
  statuses: RoomStatus[];
  errors: RoomError[];
  messages: { deviceId: string; text: string }[];
  viewerLists: RoomViewerInfo[][];
}

/** A room joined with these devices, its own offer answered and its PeerConnection connected. */
async function joinedRoom(
  devices: DeviceInfo[],
  options: { ipc?: boolean; connect?: boolean; viewers?: { viewerId: string; dataChannels?: boolean; away?: boolean }[] } = {},
): Promise<Setup> {
  const room = new CloudflareRoom({
    apiUrl: "https://worker.test/cloudflare/",
    apiKey: "viewer-key",
    roomId: "lab-a",
    viewerId: "alice",
    ipc: options.ipc,
  });
  let latest: RoomDevice[] = [];
  const statuses: RoomStatus[] = [];
  const errors: RoomError[] = [];
  const messages: { deviceId: string; text: string }[] = [];
  const viewerLists: RoomViewerInfo[][] = [];
  room.onDevices = (list) => (latest = list);
  room.onViewers = (list) => viewerLists.push(list);
  room.onStatus = (status) => statuses.push(status);
  room.onError = (error) => errors.push(error);
  room.onMessage = (deviceId, data) => messages.push({ deviceId, text: new TextDecoder().decode(data) });
  room.connect();
  await flush();
  const ws = FakeWebSocket.all.at(-1)!;
  ws.open();
  ws.receive({
    joined: {
      viewerId: "alice",
      room: "lab-a",
      resumed: false,
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      devices,
      viewers: options.viewers ?? [],
    },
  });
  await flush();
  const pc = FakePeer.all.at(-1)!;
  if (options.connect !== false) {
    ws.receive({ answer: { sdp: "sfu-answer" } });
    await flush();
    pc.setState("connected");
    await flush();
  }
  return { room, ws, pc, devices: () => latest, statuses, errors, messages, viewerLists };
}

/** The worker answers the subscribe in flight with this offer and these subscriptions. */
async function subscribed(setup: Setup, tracks: { deviceId: string; trackName: string; mid: string; generation: number }[]) {
  setup.ws.receive({ offer: { sdp: "sfu-offer", tracks } });
  await flush();
  for (const track of tracks) {
    if (!setup.pc.transceivers.some((transceiver) => transceiver.mid === track.mid)) {
      setup.pc.addTrack(track.mid);
    }
  }
  setup.ws.receive({ subscribed: { tracks } });
  await flush();
}

function ipcText(text: string): Uint8Array {
  return Packet.encode(Packet.fromPartial({ raw: new TextEncoder().encode(text) })).finish();
}

function reset() {
  FakeWebSocket.all = [];
  FakePeer.all = [];
  tokenRequests.length = 0;
  tokenStatus = 200;
  timers.length = 0;
}

// --- tests -----------------------------------------------------------------------------------

async function main() {
  console.log("[1] the token comes from {apiUrl}/token with the viewer key");
  {
    reset();
    const { room } = await joinedRoom([], { ipc: false });
    const request = tokenRequests[0];
    check(request.url === "https://worker.test/cloudflare/token", `url ${request.url}`);
    check(request.headers.Authorization === "Bearer viewer-key", "bearer viewer key");
    check(request.body.viewer_id === "alice" && request.body.room_id === "lab-a" && request.body.can_subscribe === true, "viewer_id, room_id, can_subscribe");
    check(!("data_channels" in request.body), "no data_channels without ipc");
    check(FakeWebSocket.all[0].url === `wss://worker.test/cloudflare/rtc?access_token=token-1`, "the socket uses the token");
    room.leave();
    reset();
    const ipcRoom = await joinedRoom([], { ipc: true });
    check(tokenRequests[0].body.data_channels === true, "data_channels with ipc");
    ipcRoom.room.leave();
  }

  console.log("[2] joined: its own offer at once, with server-events on id 0");
  {
    reset();
    const { room, ws, pc } = await joinedRoom([device("cam", SLEEPING, 0)], { connect: false });
    check(JSON.stringify(pc.config.iceServers) === JSON.stringify([{ urls: ["stun:stun.cloudflare.com:3478"] }]), "ICE servers from joined, empty credentials left out");
    const events = pc.channel("server-events");
    check(events?.init.negotiated === true && events?.init.id === 0, "negotiated server-events, id 0");
    check(ws.requests("offer").length === 1 && ws.requests("offer")[0].sdp === "offer-0-1", "the offer went out");
    room.leave();
  }

  console.log("[3] subscribes only once the PeerConnection is connected");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)], { connect: false });
    check(setup.ws.requests("subscribe").length === 0, "nothing before the answer");
    setup.ws.receive({ answer: { sdp: "sfu-answer" } });
    await flush();
    check(setup.pc.remote.at(-1)?.sdp === "sfu-answer", "answer applied");
    check(setup.ws.requests("subscribe").length === 0, "nothing while connecting");
    setup.pc.setState("connected");
    await flush();
    const subs = setup.ws.requests("subscribe");
    check(subs.length === 1 && subs[0].tracks[0]?.deviceId === "cam" && subs[0].tracks[0]?.trackName === "video", "subscribe once connected");
    setup.room.leave();
  }

  console.log("[4] the SFU's offer is answered and the tracks are grouped by device");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1, { tracks: ["video", "audio"] })]);
    await subscribed(setup, [
      { deviceId: "cam", trackName: "video", mid: "1", generation: 1 },
      { deviceId: "cam", trackName: "audio", mid: "2", generation: 1 },
    ]);
    check(setup.ws.requests("answer").at(-1)?.sdp === "answer-0", "answer sent");
    const cam = setup.devices().find((info) => info.deviceId === "cam");
    check(cam?.state === "live", "live");
    check(cam?.stream?.getTracks().length === 2, "one stream with both tracks");
    const first = cam?.stream;
    setup.ws.receive({ device: device("cam", LIVE, 1, { tracks: ["video", "audio"] }) });
    await flush();
    check(setup.devices()[0].stream === first, "same stream while the tracks stay");
    setup.room.leave();
  }

  console.log("[5] a device that stops publishing is unsubscribed");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    await subscribed(setup, [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }]);
    setup.ws.receive({ device: device("cam", SLEEPING, 1) });
    await flush();
    check(JSON.stringify(setup.ws.requests("unsubscribe").at(-1)?.mids) === JSON.stringify(["1"]), "unsubscribe mid 1");
    setup.room.leave();
  }

  console.log("[6] a refusal for good waits for the next publication; one for now is retried");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1), device("cam2", LIVE, 1)]);
    setup.ws.receive({ error: { code: ErrorCode.ERROR_CODE_VIEWER_LIMIT, request: "subscribe", deviceId: "cam", message: "full" } });
    setup.ws.receive({ error: { code: ErrorCode.ERROR_CODE_TRACK_NOT_READY, request: "subscribe", deviceId: "cam2", message: "not yet" } });
    await subscribed(setup, []);
    check(setup.devices().find((info) => info.deviceId === "cam")?.error === "viewer_limit", "the refusal shows on the device");
    const before = setup.ws.requests("subscribe").length;
    await advance(500);
    check(setup.ws.requests("subscribe").length === before, "nothing asked within the backoff");
    await advance(600);
    const again = setup.ws.requests("subscribe").at(-1);
    check(setup.ws.requests("subscribe").length === before + 1, "asked again after 1 s");
    check(again?.tracks.length === 1 && again.tracks[0].deviceId === "cam2", "only the device refused for now");
    await subscribed(setup, [{ deviceId: "cam2", trackName: "video", mid: "1", generation: 1 }]);
    setup.ws.receive({ device: device("cam", LIVE, 2) });
    await flush();
    check(setup.ws.requests("subscribe").at(-1)?.tracks[0]?.deviceId === "cam", "a new publication is asked for");
    setup.room.leave();
  }

  console.log("[7] a device that left the room is forgotten, so its generation 1 is asked for again");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    setup.ws.receive({ error: { code: ErrorCode.ERROR_CODE_VIEWER_LIMIT, request: "subscribe", deviceId: "cam", message: "full" } });
    await subscribed(setup, []);
    setup.ws.receive({ members: { devices: [] } });
    await flush();
    check(setup.devices().length === 0, "gone from the list");
    setup.ws.receive({ members: { devices: [device("cam", LIVE, 1)] } });
    await flush();
    check(setup.ws.requests("subscribe").at(-1)?.tracks[0]?.deviceId === "cam", "asked for again");
    setup.room.leave();
  }

  console.log("[8] a failed PeerConnection is rebuilt with a new offer");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    await subscribed(setup, [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }]);
    setup.pc.setState("failed");
    await flush();
    const second = FakePeer.all.at(-1)!;
    check(FakePeer.all.length === 2 && setup.pc.connectionState === "closed", "a new PeerConnection");
    check(setup.ws.requests("offer").at(-1)?.sdp === "offer-1-1", "its own offer");
    check(setup.devices()[0].stream === undefined, "no stream until subscribed again");
    // Requests about the old session are ignored until the answer.
    setup.ws.receive({ subscribed: { tracks: [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }] } });
    setup.ws.receive({ offer: { sdp: "stale-offer", tracks: [] } });
    await flush();
    check(second.remote.length === 0 && setup.ws.requests("answer").length === 1, "offer and subscribed ignored while our offer waits");
    setup.ws.receive({ answer: { sdp: "sfu-answer-2" } });
    await flush();
    second.setState("connected");
    await flush();
    check(setup.ws.requests("subscribe").length === 2, "subscribes again on the new session");
    setup.room.leave();
  }

  console.log("[9] a PeerConnection still not connected 4 s after a device went live is rebuilt");
  {
    reset();
    const setup = await joinedRoom([device("cam", SLEEPING, 0)], { connect: false });
    setup.ws.receive({ answer: { sdp: "sfu-answer" } });
    await flush();
    setup.ws.receive({ device: device("cam", LIVE, 1) });
    await flush();
    await advance(3_900);
    check(FakePeer.all.length === 1, "not before 4 s");
    await advance(200);
    check(FakePeer.all.length === 2 && setup.ws.requests("offer").length === 2, "rebuilt with a new offer");
    setup.room.leave();
  }

  console.log("[10] an offer the worker could not take is tried again after a backoff");
  {
    reset();
    const setup = await joinedRoom([], { connect: false });
    setup.ws.receive({ error: { code: ErrorCode.ERROR_CODE_SFU, request: "offer", message: "SFU timeout" } });
    await flush();
    await advance(1_900);
    check(FakePeer.all.length === 1, "waits");
    await advance(200);
    check(FakePeer.all.length === 2 && setup.ws.requests("offer").length === 2, "new PeerConnection and offer after 2 s");
    setup.room.leave();
  }

  console.log("[11] session_reset: a new PeerConnection answers, then sends its own offer");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    setup.ws.receive({ offer: { sdp: "reset-offer", sessionReset: true, tracks: [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }] } });
    await flush();
    const second = FakePeer.all.at(-1)!;
    check(FakePeer.all.length === 2 && second.remote[0]?.sdp === "reset-offer", "the new PeerConnection takes the offer");
    check(setup.ws.requests("offer").length === 1, "no own offer yet");
    setup.ws.receive({ subscribed: { tracks: [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }] } });
    await flush();
    check(setup.ws.requests("offer").length === 2, "own offer after subscribed");
    setup.room.leave();
  }

  console.log("[12] a dropped socket reconnects with a new token and resumes on the same PeerConnection");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    await subscribed(setup, [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }]);
    setup.ws.drop(1006);
    await flush();
    check(setup.statuses.at(-1) === "reconnecting", "reconnecting");
    await advance(1_000);
    check(tokenRequests.length === 2 && FakeWebSocket.all.length === 2, "a new token and socket after 1 s");
    const ws2 = FakeWebSocket.all[1];
    ws2.open();
    ws2.receive({
      joined: {
        viewerId: "alice",
        room: "lab-a",
        resumed: true,
        devices: [device("cam", LIVE, 1)],
        subscriptions: [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }],
      },
    });
    await flush();
    check(FakePeer.all.length === 1 && ws2.requests("offer").length === 0, "same PeerConnection, no new offer");
    check(setup.devices()[0].stream?.getTracks().length === 1, "the stream stays");
    check(setup.statuses.at(-1) === "joined", "joined again");
    setup.room.leave();
  }

  console.log("[13] resumed while our offer waited: start over");
  {
    reset();
    const setup = await joinedRoom([], { connect: false });
    setup.ws.drop(1006);
    await advance(1_000);
    const ws2 = FakeWebSocket.all[1];
    ws2.open();
    ws2.receive({ joined: { viewerId: "alice", room: "lab-a", resumed: true } });
    await flush();
    check(FakePeer.all.length === 2 && ws2.requests("offer").length === 1, "new PeerConnection and offer");
    setup.room.leave();
  }

  console.log("[14] replaced by another connection: stop, and do not reconnect");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    setup.ws.drop(CloseCode.CLOSE_CODE_REPLACED);
    await flush();
    await advance(60_000);
    check(setup.errors.some((error) => error.code === "replaced"), "onError replaced");
    check(setup.statuses.at(-1) === "closed", "closed");
    check(FakeWebSocket.all.length === 1, "no new socket");
    check(setup.devices().length === 0, "no devices");
  }

  console.log("[15] viewer_gone: join again from the start");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    setup.ws.receive({ error: { code: ErrorCode.ERROR_CODE_VIEWER_GONE, request: "subscribe", message: "gone" } });
    await flush();
    check(setup.pc.connectionState === "closed", "PeerConnection closed");
    await advance(1_000);
    check(tokenRequests.length === 2, "a new token");
    const ws2 = FakeWebSocket.all[1];
    ws2.open();
    ws2.receive({ joined: { viewerId: "alice", room: "lab-a", resumed: false, devices: [device("cam", LIVE, 1)] } });
    await flush();
    check(FakePeer.all.length === 2 && ws2.requests("offer").length === 1, "new PeerConnection and offer");
    setup.room.leave();
  }

  console.log("[16] data channels, control and IPC");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1, { dataChannels: true })], { ipc: true });
    await subscribed(setup, [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }]);
    check(JSON.stringify(setup.ws.requests("subscribe").at(-1)?.data) === JSON.stringify(["cam"]), "data after the tracks");
    const channels = [
      { label: "_lossy", id: 2 },
      { label: "_reliable", id: 4 },
    ];
    setup.ws.receive({ subscribed: { tracks: [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }], data: [{ deviceId: "cam", generation: 1, channels, canReply: false }] } });
    await flush();
    const lossy = setup.pc.channel("_lossy")!;
    const reliable = setup.pc.channel("_reliable")!;
    check(lossy.init.negotiated === true && lossy.init.id === 2 && lossy.init.ordered === false && lossy.init.maxRetransmits === 0, "_lossy: negotiated id 2, unordered, no retransmits");
    check(reliable.init.negotiated === true && reliable.init.id === 4 && reliable.init.ordered === true, "_reliable: negotiated id 4, ordered");
    lossy.open();
    reliable.open();
    reliable.receive(ipcText("hello viewer"));
    await flush();
    check(setup.messages.at(-1)?.text === "hello viewer" && setup.messages.at(-1)?.deviceId === "cam", "onMessage");
    check(!setup.room.canSend("cam"), "cannot send before control");
    check(setup.room.sendText("cam", "nope") === false && reliable.sent.length === 0, "sendText refused");

    setup.room.takeControl("cam");
    check(setup.ws.requests("takeControl").at(-1)?.deviceId === "cam", "take_control sent");
    const me = { room: "lab-a", viewerId: "alice" };
    setup.ws.receive({ device: device("cam", LIVE, 1, { dataChannels: true, handover: me }) });
    setup.ws.receive({ subscribed: { tracks: [{ deviceId: "cam", trackName: "video", mid: "1", generation: 1 }], data: [{ deviceId: "cam", generation: 1, channels, canReply: true }] } });
    await flush();
    check(setup.ws.requests("controlReady").at(-1)?.deviceId === "cam", "control_ready once canReply and _reliable is open");
    check(setup.devices()[0].control.takingOver, "taking over");
    setup.ws.receive({ device: device("cam", LIVE, 1, { dataChannels: true, controller: me }) });
    await flush();
    const cam = setup.devices()[0];
    check(cam.control.mine && cam.canSend, "in control, can send");
    check(setup.room.sendText("cam", "hello device") === true, "sendText");
    const packet = Packet.decode(reliable.sent.at(-1)!);
    check(new TextDecoder().decode(packet.raw) === "hello device", "Packet { raw } on _reliable");
    setup.room.ipcSink("cam").sendToEndpoint(new Uint8Array([1, 2]), "lossy", { endpoint: "gamepad" });
    const pad = Packet.decode(lossy.sent.at(-1)!);
    check(pad.ipc?.endpoint === "gamepad" && pad.ipc?.payload.length === 2, "ipcSink sends to an endpoint on _lossy");

    setup.ws.receive({ error: { code: ErrorCode.ERROR_CODE_NOT_CONTROLLER, request: "release_control", deviceId: "cam2", message: "no" } });
    await flush();
    check(setup.errors.at(-1)?.code === "not_controller" && setup.errors.at(-1)?.deviceId === "cam2", "control errors reach onError");

    setup.room.releaseControl("cam");
    check(setup.ws.requests("releaseControl").at(-1)?.deviceId === "cam", "release_control sent");
    setup.room.leave();
    check(lossy.readyState === "closed" && reliable.readyState === "closed", "channels closed on leave");
  }

  console.log("[17] leave: tells the worker, closes everything, empties the list");
  {
    reset();
    let pagehide: (() => void) | undefined;
    (globalThis as any).addEventListener = (type: string, fn: () => void) => {
      if (type === "pagehide") {
        pagehide = fn;
      }
    };
    (globalThis as any).removeEventListener = (type: string) => {
      if (type === "pagehide") {
        pagehide = undefined;
      }
    };
    const setup = await joinedRoom([device("cam", LIVE, 1)]);
    pagehide?.();
    check(setup.ws.requests("leave").length === 1, "pagehide sends leave");
    setup.room.leave();
    await flush();
    check(setup.ws.requests("leave").length === 2 && setup.ws.closedBy === 1000, "leave sent, socket closed");
    check(setup.pc.connectionState === "closed", "PeerConnection closed");
    check(setup.statuses.at(-1) === "closed" && setup.devices().length === 0, "closed, no devices");
    check(pagehide === undefined, "pagehide listener removed");
    delete (globalThis as any).addEventListener;
    delete (globalThis as any).removeEventListener;
  }

  console.log("[18] a failed token request is reported and retried");
  {
    reset();
    tokenStatus = 401;
    const room = new CloudflareRoom({ apiUrl: "https://worker.test/cloudflare", apiKey: "wrong", roomId: "lab-a" });
    const errors: RoomError[] = [];
    room.onError = (error) => errors.push(error);
    room.connect();
    await flush();
    check(errors[0]?.code === "token" && errors[0]?.message === "Wrong key.", "onError token with the worker's message");
    check(/^[0-9a-f-]{36}$/.test(tokenRequests[0].body.viewer_id), "a random viewer id by default");
    await advance(1_000);
    check(tokenRequests.length === 2, "tried again");
    room.leave();
  }
  console.log("[19] takeControl before the channels open waits for them");
  {
    reset();
    const setup = await joinedRoom([device("cam", LIVE, 1, { dataChannels: true }), device("cam2", LIVE, 1, { dataChannels: true })], { ipc: true });
    setup.room.takeControl("cam");
    setup.room.takeControl("cam2");
    setup.room.releaseControl("cam2");
    check(setup.ws.requests("takeControl").length === 0, "nothing sent before the channels");
    await subscribed(setup, [
      { deviceId: "cam", trackName: "video", mid: "1", generation: 1 },
      { deviceId: "cam2", trackName: "video", mid: "2", generation: 1 },
    ]);
    const data = ["cam", "cam2"].map((deviceId, i) => ({
      deviceId,
      generation: 1,
      channels: [{ label: "_lossy", id: 2 + 4 * i }, { label: "_reliable", id: 4 + 4 * i }],
      canReply: false,
    }));
    setup.ws.receive({ subscribed: { tracks: [], data } });
    await flush();
    check(setup.ws.requests("takeControl").length === 0, "nothing while the channels connect");
    for (const channel of setup.pc.channels.filter((c) => c.label !== "server-events")) {
      channel.open();
    }
    await flush();
    const takes = setup.ws.requests("takeControl");
    check(takes.length === 1 && takes[0].deviceId === "cam", "sent once _reliable opened, only for the device still wanted");
    check(setup.ws.requests("releaseControl").length === 0, "a release before sending sends nothing");
    setup.room.leave();

    reset();
    const plain = await joinedRoom([device("cam", LIVE, 1, { dataChannels: true })]);
    plain.room.takeControl("cam");
    check(plain.ws.requests("takeControl").length === 0, "no take_control without ipc");
    plain.room.leave();
  }
  console.log("[20] who else is in the room");
  {
    reset();
    const setup = await joinedRoom([], { viewers: [{ viewerId: "alice", dataChannels: true }, { viewerId: "Bob Lee" }] });
    check(
      JSON.stringify(setup.viewerLists.at(-1)) ===
        JSON.stringify([
          { viewerId: "alice", ipc: true, away: false, me: true },
          { viewerId: "Bob Lee", ipc: false, away: false, me: false },
        ]),
      "joined lists everyone, this viewer marked",
    );
    setup.ws.receive({ viewers: { viewers: [{ viewerId: "alice", dataChannels: true }, { viewerId: "Bob Lee", away: true }] } });
    await flush();
    check(setup.room.viewers[1]?.away === true && setup.viewerLists.length === 2, "viewers updates the list");
    setup.room.leave();
    check(setup.viewerLists.at(-1)?.length === 0, "empty after leave");
  }
}

main().then(() => {
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
  process.exit(0);
});
