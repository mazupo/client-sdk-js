// MqttCamera and LiveKitRoom against fake signaling and fake WebRTC: the status, IPC routing,
// streams and room lists that Connection and SfuRoom promise.
//
// Run with: npm test. build.js swaps the `mqtt` package for test/fakes/mqtt.ts.

import { DataPacket, UserPacket } from "@livekit/protocol";
import { ConnectionError, ConnectionStatus } from "../src/connection/types";
import { LiveKitRoom } from "../src/livekit/livekit-room";
import { LiveKitDevice, LiveKitViewer } from "../src/livekit/types";
import { MqttCamera } from "../src/mqtt/mqtt-camera";
import { Packet } from "../src/proto/packet";
import { FakeMqttClient } from "./fakes/mqtt";

let failures = 0;

function check(ok: boolean, what: string) {
  console.log((ok ? "  ok   " : "  FAIL ") + what);
  if (!ok) {
    failures++;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- WebRTC ----------------------------------------------------------------------------------

class FakeTrack {
  enabled = true;
  constructor(public id: string, public kind: string) {}
  stop() {}
}

class FakeStream {
  private tracks: FakeTrack[];
  constructor(tracksOrId?: FakeTrack[] | string, public id = "stream") {
    this.tracks = Array.isArray(tracksOrId) ? [...tracksOrId] : [];
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getTrackById(id: string) {
    return this.tracks.find((track) => track.id === id) ?? null;
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
}
(globalThis as any).MediaStream = FakeStream;

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  binaryType = "blob";
  bufferedAmount = 0;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  constructor(public label: string, public init: RTCDataChannelInit) {}
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  receive(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakePeer {
  static all: FakePeer[] = [];
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  ontrack: ((event: any) => void) | null = null;
  onicecandidate: ((event: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: any) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  channels: FakeChannel[] = [];
  receivers: { track: FakeTrack }[] = [];
  constructor(public config: RTCConfiguration) {
    FakePeer.all.push(this);
  }
  createDataChannel(label: string, init: RTCDataChannelInit = {}) {
    const channel = new FakeChannel(label, init);
    this.channels.push(channel);
    return channel;
  }
  addTransceiver() {}
  getTransceivers() {
    return [];
  }
  getReceivers() {
    return this.receivers;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\na=mid:1\r\n" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0 answer" };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
  }
  addIceCandidate() {}
  restartIce() {}
  async getStats() {
    return new Map();
  }
  close() {
    this.connectionState = "closed";
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  /** A remote track arrives in the stream with this id. */
  track(kind: string, streamId: string) {
    const track = new FakeTrack(`${kind}-${this.receivers.length}`, kind);
    const receiver = { track };
    this.receivers.push(receiver);
    this.ontrack?.({ track, receiver, streams: [new FakeStream([track], streamId)], transceiver: { mid: String(this.receivers.length) } });
  }
  /** The SFU opens a channel in-band. */
  remoteChannel(label: string) {
    const channel = new FakeChannel(label, {});
    channel.readyState = "open";
    this.ondatachannel?.({ channel });
    return channel;
  }
  channel(label: string) {
    return this.channels.find((channel) => channel.label === label)!;
  }
}
(globalThis as any).RTCPeerConnection = FakePeer;

// --- the LiveKit relay -----------------------------------------------------------------------

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: { action: string; message: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(action: string, message: unknown) {
    this.onmessage?.({ data: JSON.stringify({ action, message: typeof message === "string" ? message : JSON.stringify(message) }) });
  }
  actions(action: string) {
    return this.sent.filter((frame) => frame.action === action);
  }
}
(globalThis as any).WebSocket = FakeSocket;

function ipc(text: string): Uint8Array {
  return Packet.encode(Packet.create({ raw: new TextEncoder().encode(text) })).finish();
}

function text(bytes: Uint8Array | undefined): string {
  return new TextDecoder().decode(bytes);
}

// --- MqttCamera ------------------------------------------------------------------------------

async function mqttCamera() {
  console.log("[1] connect: the offer goes to the device's topic, capped at maxBitrate");
  const camera = new MqttCamera({ deviceId: "cam-1", host: "mqtt.test", datachannelOnly: true, maxBitrate: 800, timeout: 0 });
  const statuses: ConnectionStatus[] = [];
  const messages: { data: string; deviceId: string }[] = [];
  const streams: string[] = [];
  camera.onStatus = (status) => statuses.push(status);
  camera.onMessage = (data, deviceId) => messages.push({ data: text(data), deviceId });
  camera.onStream = (_stream, id) => streams.push(id);
  camera.connect();
  await wait(10);
  const mqtt = FakeMqttClient.all.at(-1)!;
  check(mqtt.options.host === "mqtt.test" && mqtt.options.path === "/mqtt" && mqtt.options.protocol === "wss", "broker options, with the defaults");
  check(mqtt.subscribed.every((topic) => topic.startsWith("cam-1/")), "subscribed under the device id");
  const offer = mqtt.published.find((p) => p.topic.startsWith("cam-1/offer/"));
  check(Boolean(offer) && JSON.parse(offer!.message).sdp.includes("b=AS:800"), "offer published with b=AS:800");
  check(statuses.join() === "connecting", "connecting");

  console.log("[2] connected once the PeerConnection is");
  const peer = FakePeer.all.at(-1)!;
  mqtt.deliver("answer", { type: "answer", sdp: "v=0 device-answer" });
  await wait(1);
  check(peer.remoteDescription?.sdp === "v=0 device-answer", "the device's answer is applied");
  peer.setState("connected");
  check(camera.status === "connected", "connected");

  console.log("[3] IPC goes over _reliable, and comes back with the device id");
  const reliable = peer.channel("_reliable");
  check(reliable.init.negotiated === true && reliable.init.id === 3, "_reliable negotiated on id 3");
  check(!camera.canSend() && camera.sendText("too early") === false, "nothing goes out before it opens");
  reliable.open();
  check(camera.canSend() && camera.sendText("hi device") === true, "sendText once open");
  check(text(Packet.decode(reliable.sent.at(-1)!).raw) === "hi device", "as Packet { raw }");
  reliable.receive(ipc("hi viewer"));
  await wait(5);
  check(messages.at(-1)?.data === "hi viewer" && messages.at(-1)?.deviceId === "cam-1", "onMessage(data, deviceId)");

  console.log("[4] streams, speaker and jitter buffer");
  peer.track("video", "camera-stream");
  peer.track("audio", "camera-stream");
  check(streams.at(-1) === "camera-stream", "onStream(stream, its id)");
  camera.toggleSpeaker(false);
  check(!camera.isSpeakerOn && peer.receivers.filter((r) => r.track.kind === "audio").every((r) => !r.track.enabled), "toggleSpeaker(false) silences what arrives");
  camera.setJitterBufferTarget(9000);
  check(camera.getJitterBufferTarget() === 4000, "the jitter target is clamped to 4000 ms");

  console.log("[5] a dropped PeerConnection is reconnecting until it is back");
  peer.setState("disconnected");
  check(camera.status === "reconnecting", "reconnecting");
  peer.setState("connected");
  check(camera.status === "connected", "connected again");

  console.log("[6] disconnect closes everything; connect starts over");
  camera.disconnect();
  check(camera.status === "closed" && peer.connectionState === "closed" && mqtt.ended, "closed, PeerConnection and broker connection ended");
  camera.connect();
  await wait(10);
  check(FakeMqttClient.all.length === 2 && camera.status === "connecting", "a new broker connection");
  camera.disconnect();

  console.log("[7] a connection that never comes up times out");
  const late = new MqttCamera({ deviceId: "cam-2", host: "mqtt.test", datachannelOnly: true, timeout: 30 });
  const errors: ConnectionError[] = [];
  late.onError = (error) => errors.push(error);
  late.connect();
  await wait(60);
  check(errors[0]?.code === "timeout" && late.status === "closed", "onError timeout, then closed");
  check(FakeMqttClient.all.at(-1)!.ended, "and its broker connection ended");

  console.log("[8] giving up on ICE restarts closes it with reconnect_failed");
  const failing = new MqttCamera({ deviceId: "cam-3", host: "mqtt.test", datachannelOnly: true, timeout: 0 });
  const failErrors: ConnectionError[] = [];
  failing.onError = (error) => failErrors.push(error);
  failing.connect();
  await wait(10);
  FakePeer.all.at(-1)!.setState("connected");
  (failing as any).peer.onReconnectFailed();
  check(failErrors[0]?.code === "reconnect_failed" && failing.status === "closed", "reconnect_failed, then closed");
}

// --- LiveKitRoom -----------------------------------------------------------------------------

async function liveKitRoom() {
  console.log("[9] connect: the relay URL, then a publisher offer after join");
  const room = new LiveKitRoom({ url: "wss://relay.test", apiKey: "lk-key", roomId: "lab-a", viewerId: "alice", timeout: 0 });
  let devices: LiveKitDevice[] = [];
  let viewers: LiveKitViewer[] = [];
  const messages: { data: string; deviceId: string }[] = [];
  const streams: string[] = [];
  room.onDevices = (list) => (devices = list);
  room.onViewers = (list) => (viewers = list);
  room.onMessage = (data, deviceId) => messages.push({ data: text(data), deviceId });
  room.onStream = (_stream, id) => streams.push(id);
  room.connect();
  const ws = FakeSocket.all.at(-1)!;
  const url = new URL(ws.url);
  check(url.origin + url.pathname === "wss://relay.test/rtc", "dials {url}/rtc");
  check(url.searchParams.get("apiKey") === "lk-key" && url.searchParams.get("roomId") === "lab-a" && url.searchParams.get("userId") === "alice", "with apiKey, roomId and the viewer id");
  ws.open();
  const before = FakePeer.all.length;
  ws.receive("join", { urls: ["stun:relay.test"] });
  await wait(5);
  const publisher = FakePeer.all[before];
  const subscriber = FakePeer.all[before + 1];
  check(Boolean(publisher && subscriber), "a publisher and a subscriber");
  check(ws.actions("offer").length === 1, "the publisher's offer is sent");

  console.log("[10] connected once the subscriber is");
  ws.receive("offer", "v=0 sfu-offer");
  await wait(5);
  check(ws.actions("answer").length === 1, "the subscriber answers the SFU");
  subscriber.setState("connected");
  check(room.status === "connected", "connected");

  console.log("[11] a participant whose video arrives is a device; the others are viewers");
  ws.receive("participant", [
    { sid: "PA_cam", id: "cam-1", state: "ACTIVE" },
    { sid: "PA_bob", id: "bob", state: "ACTIVE" },
  ]);
  await wait(1);
  check(devices.length === 0 && viewers.map((v) => v.viewerId).join() === "alice,cam-1,bob", "before any video, all are viewers, this one first");
  subscriber.track("video", "PA_cam|TR_video");
  await wait(1);
  check(devices.map((d) => d.deviceId).join() === "cam-1" && devices[0].stream !== undefined, "cam-1 is a device with its stream");
  check(viewers.map((v) => `${v.viewerId}${v.me ? "*" : ""}`).join() === "alice*,bob", "the viewers are this one and bob");
  check(streams.at(-1) === "cam-1", "onStream(stream, the device's identity)");
  subscriber.track("audio", "PA_bob|TR_mic");
  await wait(1);
  check(devices.length === 1, "audio alone does not make a device");

  console.log("[12] sendText goes to the room, sendTextTo to one device");
  const reliable = publisher.channel("_reliable");
  check(!room.canSend(), "nothing before the publisher's channel opens");
  reliable.open();
  check(room.canSend() && room.sendText("everyone") === true, "sendText");
  let packet = DataPacket.fromBinary(reliable.sent.at(-1)!);
  check(packet.destinationIdentities.length === 0 && packet.value.case === "user", "to everyone");
  check(text(Packet.decode((packet.value.value as UserPacket).payload).raw) === "everyone", "with the text in Packet { raw }");
  check(room.canSendTo("cam-1") && room.sendTextTo("cam-1", "just you") === true, "sendTextTo");
  packet = DataPacket.fromBinary(reliable.sent.at(-1)!);
  check(packet.destinationIdentities.join() === "cam-1", "addressed to cam-1");
  check(!room.canSendTo("nobody") && room.sendTextTo("nobody", "x") === false, "not to someone who is not a device here");

  console.log("[13] a message from a device carries its identity");
  const incoming = subscriber.remoteChannel("_reliable");
  const fromCam = new DataPacket({
    participantIdentity: "cam-1",
    value: { case: "user", value: new UserPacket({ payload: ipc("hello alice") }) },
  });
  incoming.receive(fromCam.toBinary());
  await wait(5);
  check(messages.at(-1)?.data === "hello alice" && messages.at(-1)?.deviceId === "cam-1", "onMessage(data, cam-1)");

  console.log("[14] a participant that left is gone from the lists");
  ws.receive("participant", [{ sid: "PA_cam", id: "cam-1", state: "DISCONNECTED" }]);
  await wait(1);
  check(devices.length === 0 && !viewers.some((v) => v.viewerId === "cam-1"), "cam-1 is gone");

  console.log("[15] LiveKit ending the session closes the room");
  const errors: ConnectionError[] = [];
  room.onError = (error) => errors.push(error);
  ws.receive("leave", "");
  check(errors[0]?.code === "left" && room.status === "closed", "onError left, then closed");
  check(publisher.connectionState === "closed" && subscriber.connectionState === "closed", "both PeerConnections closed");
}

async function main() {
  await mqttCamera();
  await liveKitRoom();
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
  process.exit(0);
}

main();
