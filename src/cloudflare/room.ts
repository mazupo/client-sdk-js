import {
  CloseCode,
  DataSubscription,
  DeepPartial,
  DeviceInfo,
  DeviceState,
  ErrorCode,
  IceServer,
  SignalError,
  Subscribe,
  SubscribeOffer,
  Subscription,
  Unsubscribe,
  ViewerInfo,
  ViewerRef,
} from '../proto/cloudflare';
import { Packet } from '../proto/packet';
import { ChannelRole, IpcMode, IpcOptions, IpcSink, roleInit } from '../peer/rtc-peer';
import { StreamAssembler } from '../rtc/datachannel-receiver';
import { sendIpc } from '../rtc/ipc-sender';
import { clampJitterBufferTarget, generateRequestId } from '../utils/rtc-tools';
import {
  ResponseFrame,
  errorName,
  openSocket,
  parseResponse,
  requestToken,
  sendRequest,
  stateName,
} from './socket';
import {
  CloudflareRoomOptions,
  RoomControl,
  RoomDevice,
  RoomError,
  RoomStatus,
  RoomViewer,
  RoomViewerInfo,
} from './types';

const LIVE = DeviceState.DEVICE_STATE_LIVE;

/** Refusals that will not change for the same publication. They are not asked for again. */
const PERMANENT = new Set([
  ErrorCode.ERROR_CODE_VIEWER_LIMIT,
  ErrorCode.ERROR_CODE_NOT_MEMBER,
  ErrorCode.ERROR_CODE_TRACK_NOT_FOUND,
  ErrorCode.ERROR_CODE_NO_DATA_CHANNELS,
]);

/** Once a device is live the SFU is reachable, and the PeerConnection gets this long to connect. */
const CONNECT_GRACE_MS = 4_000;

/** The delivery every end of a device's channels uses (see cloudflare.proto). */
const CHANNEL_INIT: Record<string, RTCDataChannelInit> = {
  _lossy: roleInit(ChannelRole.Lossy),
  _reliable: roleInit(ChannelRole.Reliable),
};

type Timer = ReturnType<typeof setTimeout>;

/** When to ask for a device again after a failed subscribe. */
interface Retry {
  generation: number;
  count: number;
  at: number;
}

/** A device's channels in our PeerConnection. */
interface DataChannels {
  generation: number;
  /** "label:id,…", to see when the worker moved them. */
  ids: string;
  canReply: boolean;
  channels: Map<string, RTCDataChannel>;
  assemblers: StreamAssembler[];
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
}

function sameViewer(a: ViewerRef | undefined, b: ViewerRef | null): boolean {
  return Boolean(a && b && a.room === b.room && a.viewerId === b.viewerId);
}

function viewer(ref: ViewerRef | undefined): RoomViewer | undefined {
  return ref ? { room: ref.room, viewerId: ref.viewerId } : undefined;
}

function rtcIceServer(server: IceServer): RTCIceServer {
  return {
    urls: server.urls,
    ...(server.username ? { username: server.username } : {}),
    ...(server.credential ? { credential: server.credential } : {}),
  };
}

/**
 * Watches one room of a cf-sfu-worker: every device in it, through one WebSocket and one
 * PeerConnection. Devices publish only while someone watches, so a device that sleeps wakes when
 * this viewer joins, and its tracks are pulled once it is live.
 *
 * With `ipc`, each live device's `_lossy` and `_reliable` channels open too: messages from the
 * device arrive on `onMessage`, and the viewer in control of a device can send to it. Only one
 * viewer controls a device at a time; others wait in line.
 */
export class CloudflareRoom {
  /** The devices in the room. Called with the whole list after every change. */
  onDevices?: (devices: RoomDevice[]) => void;
  /** Who is in the room, this viewer included. Called with the whole list after every change. */
  onViewers?: (viewers: RoomViewerInfo[]) => void;
  /** An IPC message from a device. Needs `ipc`. */
  onMessage?: (deviceId: string, data: Uint8Array) => void;
  onStatus?: (status: RoomStatus) => void;
  onError?: (error: RoomError) => void;

  readonly roomId: string;
  readonly viewerId: string;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly ipc: boolean;
  private jitterBufferTarget?: number | null;

  /** The one socket in use. Events from any older socket are ignored. */
  private socket: WebSocket | null = null;
  private connectSeq = 0;
  private reconnectTimer?: Timer;
  private syncTimer?: Timer;
  private rebuildTimer?: Timer;
  private connectCheck?: Timer;
  private pc: RTCPeerConnection | null = null;
  private iceServers: RTCIceServer[] = [];
  private leaving = true;
  private attempt = 0;
  private status: RoomStatus = 'closed';
  /** Who this viewer is in the room, once joined. */
  private me: ViewerRef | null = null;
  /** Frames are handled one at a time, in order. */
  private inbox: Promise<void> = Promise.resolve();

  /** True from sending subscribe or unsubscribe until the worker answers. */
  private busy = false;
  /** What the request in flight asks for, so per-device errors go to the right retry list. */
  private pending: 'tracks' | 'data' = 'tracks';
  private busyFailures = 0;
  /**
   * Our own offers without an answer yet. Only the answer to the last one applies, and
   * subscribing waits until then.
   */
  private ownOffers = 0;
  /** Own offers in a row the worker could not take, for the backoff. */
  private offerFailures = 0;
  /** A new PeerConnection after a session reset sends its own offer again. */
  private offerDue = false;

  private readonly infos = new Map<string, DeviceInfo>();
  private viewerInfos: ViewerInfo[] = [];
  private readonly subscriptions = new Map<string, Subscription>(); // by mid
  private readonly dataSubs = new Map<string, DataChannels>(); // by device id
  private readonly refused = new Map<string, { generation: number; code: ErrorCode }>();
  private readonly retries = new Map<string, Retry>();
  private readonly dataRetries = new Map<string, Retry>();
  private readonly streams = new Map<string, MediaStream>();
  /** takeControl() calls that wait for the device's channels to open. */
  private readonly pendingTakes = new Set<string>();
  private emitQueued = false;

  constructor(options: CloudflareRoomOptions) {
    if (!options.apiUrl || !options.apiKey || !options.roomId) {
      throw new Error('CloudflareRoom needs apiUrl, apiKey and roomId.');
    }
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.roomId = options.roomId;
    this.viewerId = options.viewerId?.trim() || generateRequestId();
    this.ipc = options.ipc ?? false;
    if (options.jitterBufferTarget !== undefined) {
      this.jitterBufferTarget = clampJitterBufferTarget(options.jitterBufferTarget);
    }
  }

  /** The devices in the room, as `onDevices` last reported them. */
  get devices(): RoomDevice[] {
    return [...this.infos.values()].map((info) => this.snapshot(info));
  }

  /** The viewers in the room, as `onViewers` last reported them. */
  get viewers(): RoomViewerInfo[] {
    return this.viewerInfos.map((info) => ({
      viewerId: info.viewerId,
      ipc: info.dataChannels,
      away: info.away,
      me: info.viewerId === this.me?.viewerId,
    }));
  }

  /** Joins the room. After a dropped connection it reconnects on its own until `leave()`. */
  connect = () => {
    if (!this.leaving) {
      console.warn('CloudflareRoom is already connected, ignoring the duplicated connect().');
      return;
    }
    this.attempt = 0;
    globalThis.addEventListener?.('pagehide', this.onPageHide);
    this.setStatus('connecting');
    void this.join();
  }

  /** Leaves the room, so the device can sleep if nobody else watches. */
  leave = () => {
    if (this.leaving && !this.socket && this.status === 'closed') {
      return;
    }
    this.shutDown(true);
    this.setStatus('closed');
  }

  /**
   * Controls the device if nobody does, or waits in line. Needs `ipc`. The worker takes it only
   * once this viewer's channels to the device are open, so until then it waits here.
   */
  takeControl = (deviceId: string) => {
    if (!this.ipc) {
      console.warn('takeControl needs a CloudflareRoom with ipc: true.');
      return;
    }
    if (this.dataSubs.get(deviceId)?.channels.get('_reliable')?.readyState === 'open') {
      sendRequest(this.socket, 'takeControl', { deviceId });
    } else {
      this.pendingTakes.add(deviceId);
    }
  }

  /** Gives up control, a takeover or a place in line. */
  releaseControl = (deviceId: string) => {
    if (this.pendingTakes.delete(deviceId)) {
      return; // never sent
    }
    sendRequest(this.socket, 'releaseControl', { deviceId });
  }

  /** Whether a message sent to the device right now would reach it. */
  canSend = (deviceId: string, mode: IpcMode = 'reliable'): boolean => {
    const data = this.dataSubs.get(deviceId);
    const info = this.infos.get(deviceId);
    return Boolean(
      data?.canReply &&
      sameViewer(info?.controller, this.me) &&
      data.channels.get(`_${mode}`)?.readyState === 'open'
    );
  }

  /** Sends text to the device's IPC socket. False if this viewer cannot send to it now. */
  sendText = (deviceId: string, text: string, mode: IpcMode = 'reliable'): boolean => {
    return this.sendData(deviceId, new TextEncoder().encode(text), mode);
  }

  /** Sends bytes to the device's IPC socket. False if this viewer cannot send to it now. */
  sendData = (deviceId: string, data: Uint8Array, mode: IpcMode = 'reliable'): boolean => {
    return this.sendToEndpoint(deviceId, data, mode);
  }

  /** @internal Addressed send, for whatever encodes for a named endpoint. */
  sendToEndpoint = (deviceId: string, data: Uint8Array, mode: IpcMode = 'reliable', options?: IpcOptions): boolean => {
    if (!this.canSend(deviceId, mode)) {
      console.warn(`Cannot send to ${deviceId}: this viewer does not control it, or its channel is not open.`);
      return false;
    }
    sendIpc(this.dataSubs.get(deviceId)?.channels.get(`_${mode}`), data, mode, options);
    return true;
  }

  /** One device as an IpcSink, e.g. for `attachGamepad`. */
  ipcSink = (deviceId: string): IpcSink => ({
    sendToEndpoint: (data, mode, options) => {
      this.sendToEndpoint(deviceId, data, mode, options);
    },
    canSend: (mode) => this.canSend(deviceId, mode),
  });

  /** The browser's stats for the room's PeerConnection. Undefined before there is one. */
  getStats = (selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined => {
    return this.pc?.getStats(selector);
  }

  /** Same as PiCamera's: retunes the jitter buffer of every track received. */
  setJitterBufferTarget = (target: number | null) => {
    this.jitterBufferTarget = clampJitterBufferTarget(target);
    this.pc?.getReceivers().forEach((receiver) => this.applyJitterBufferTarget(receiver));
  }

  getJitterBufferTarget = (): number | null | undefined => {
    return this.jitterBufferTarget;
  }

  private onPageHide = () => {
    sendRequest(this.socket, 'leave');
  }

  private setStatus(status: RoomStatus) {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.onStatus?.(status);
  }

  private setViewers(viewers: ViewerInfo[]) {
    if (this.viewerInfos.length === 0 && viewers.length === 0) {
      return;
    }
    this.viewerInfos = viewers;
    this.onViewers?.(this.viewers);
  }

  private emitError(error: RoomError) {
    this.onError?.(error);
  }

  /** Reports the device list once, after the current burst of changes. */
  private changed() {
    if (this.emitQueued) {
      return;
    }
    this.emitQueued = true;
    void Promise.resolve().then(() => {
      this.emitQueued = false;
      this.onDevices?.(this.devices);
    });
  }

  private async join(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.dropSocket();
    const seq = ++this.connectSeq;
    this.leaving = false;
    try {
      const { token, url } = await requestToken(this.apiUrl, this.apiKey, {
        viewer_id: this.viewerId,
        room_id: this.roomId,
        can_subscribe: true,
        ...(this.ipc ? { data_channels: true as const } : {}),
      });
      if (seq !== this.connectSeq || this.leaving) {
        return;
      }
      const ws = openSocket(url, token);
      this.socket = ws;
      ws.addEventListener('message', (event) => {
        if (ws !== this.socket) {
          return;
        }
        const frame = parseResponse(event.data);
        if (frame) {
          this.inbox = this.inbox.then(() => this.handle(frame)).catch((err) => {
            console.error('CloudflareRoom: handling a message failed =>', err);
          });
        }
      });
      ws.addEventListener('close', (event) => {
        if (ws === this.socket) {
          this.onClose(event);
        }
      });
    } catch (error) {
      if (seq !== this.connectSeq) {
        return;
      }
      this.emitError({ code: 'token', message: error instanceof Error ? error.message : String(error) });
      this.scheduleReconnect();
    }
  }

  private dropSocket() {
    const old = this.socket;
    this.socket = null;
    old?.close(1000, 'closed by the viewer');
  }

  /** Stops everything. The device list empties. */
  private shutDown(sendLeave: boolean) {
    this.leaving = true;
    this.connectSeq++;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.syncTimer);
    clearTimeout(this.rebuildTimer);
    clearTimeout(this.connectCheck);
    this.reconnectTimer = undefined;
    this.connectCheck = undefined;
    this.ownOffers = 0;
    this.offerFailures = 0;
    this.offerDue = false;
    this.busy = false;
    if (sendLeave) {
      sendRequest(this.socket, 'leave');
    }
    this.dropSocket();
    this.resetPeer(false);
    this.infos.clear();
    this.refused.clear();
    this.retries.clear();
    this.dataRetries.clear();
    this.pendingTakes.clear();
    this.me = null;
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    this.changed();
    this.setViewers([]);
  }

  private onClose(event: CloseEvent) {
    this.socket = null;
    this.busy = false;
    if (this.leaving) {
      return;
    }
    if (event.code === CloseCode.CLOSE_CODE_REPLACED) {
      this.shutDown(false);
      this.emitError({ code: 'replaced', message: 'Another connection joined the room with this viewer id.' });
      this.setStatus('closed');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.leaving || this.reconnectTimer) {
      return;
    }
    this.setStatus('reconnecting');
    // The same viewer id within 30 s resumes the subscriptions on the worker.
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.leaving) {
        void this.join();
      }
    }, backoff(this.attempt++));
  }

  private async handle(frame: ResponseFrame): Promise<void> {
    switch (frame.action) {
      case 'joined': {
        const message = frame.message;
        this.attempt = 0;
        this.iceServers = message.iceServers.map(rtcIceServer);
        this.me = { room: message.room, viewerId: message.viewerId };
        // An answer to an offer sent on the old socket is lost. Without it, start over.
        if (!message.resumed || !this.pc || this.ownOffers > 0) {
          this.ownOffers = 0;
          this.resetPeer(true);
          void this.connectEarly();
        } else {
          this.setSubscriptions(message.subscriptions);
          this.setData(message.data);
        }
        this.infos.clear();
        for (const info of message.devices) {
          this.infos.set(info.deviceId, info);
        }
        this.setViewers(message.viewers);
        this.busy = false;
        this.setStatus('joined');
        this.changed();
        this.sync();
        break;
      }
      case 'device':
        this.infos.set(frame.message.deviceId, frame.message);
        if (frame.message.state === LIVE) {
          this.checkConnects();
        }
        this.changed();
        this.sync();
        break;
      case 'members': {
        // Frames come in order, so this list is newer than any device message before it.
        const next = new Map(frame.message.devices.map((info) => [info.deviceId, info]));
        this.infos.clear();
        for (const [id, info] of next) {
          this.infos.set(id, info);
        }
        // A device that left counts its generations from 1 again when it comes back.
        for (const list of [this.refused, this.retries, this.dataRetries, this.pendingTakes]) {
          for (const id of [...list.keys()]) {
            if (!this.infos.has(id)) {
              list.delete(id);
            }
          }
        }
        for (const id of [...this.dataSubs.keys()]) {
          if (!this.infos.has(id)) {
            this.closeChannels(id);
          }
        }
        this.changed();
        this.sync();
        break;
      }
      case 'viewers':
        this.setViewers(frame.message.viewers);
        break;
      case 'offer':
        await this.onOffer(frame.message);
        break;
      case 'answer': {
        this.ownOffers = Math.max(0, this.ownOffers - 1);
        // The answer to an offer from a PeerConnection we have replaced since.
        const peer = this.pc;
        if (this.ownOffers > 0 || !peer) {
          break;
        }
        this.offerFailures = 0;
        try {
          await peer.setRemoteDescription({ type: 'answer', sdp: frame.message.sdp });
        } catch (err) {
          console.warn('CloudflareRoom: the SFU answer did not apply, starting over =>', err);
          this.rebuildPeer();
          break;
        }
        this.sync();
        break;
      }
      case 'subscribed': {
        // About the session our pending offer replaces.
        if (this.ownOffers > 0) {
          break;
        }
        const message = frame.message;
        this.setSubscriptions(message.tracks);
        this.setData(message.data);
        for (const sub of message.tracks) {
          this.retries.delete(sub.deviceId);
        }
        for (const sub of message.data) {
          this.dataRetries.delete(sub.deviceId);
        }
        this.busy = false;
        this.busyFailures = 0;
        this.attachTracks();
        if (this.offerDue) {
          this.offerDue = false;
          void this.connectEarly();
        }
        this.changed();
        this.sync();
        break;
      }
      case 'error':
        this.onSignalError(frame.message);
        break;
    }
  }

  private onSignalError(error: SignalError) {
    if (error.code === ErrorCode.ERROR_CODE_VIEWER_GONE) {
      // The worker forgot this viewer. Join again from the start.
      this.dropSocket();
      this.resetPeer(false);
      this.ownOffers = 0;
      this.busy = false;
      this.scheduleReconnect();
      return;
    }

    if (error.deviceId && error.request === 'subscribe') {
      // The worker still finishes the request for the other devices.
      const generation = this.infos.get(error.deviceId)?.generation ?? 0;
      if (PERMANENT.has(error.code) && this.pending !== 'data') {
        this.refused.set(error.deviceId, { generation, code: error.code });
      } else {
        // Usually the device is still connecting. Ask again in a moment.
        const list = this.pending === 'data' ? this.dataRetries : this.retries;
        const previous = list.get(error.deviceId);
        const count = previous?.generation === generation ? previous.count + 1 : 0;
        const at = PERMANENT.has(error.code) ? Infinity : Date.now() + Math.min(10_000, 1000 * 2 ** count);
        list.set(error.deviceId, { generation, count, at });
      }
      this.changed();
      return;
    }

    if (error.request === 'offer') {
      this.ownOffers = Math.max(0, this.ownOffers - 1);
      if (this.ownOffers > 0) {
        return;
      }
      // The worker could not take our offer, e.g. the SFU did not answer. Start over in a moment.
      this.offerFailures++;
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => this.rebuildPeer(), Math.min(10_000, 1000 * 2 ** this.offerFailures));
      return;
    }

    if (error.request === 'answer' && error.code !== ErrorCode.ERROR_CODE_NO_OFFER) {
      // The SFU did not take our answer, so its session and our PeerConnection disagree. Start over.
      this.rebuildPeer();
      return;
    }

    if (['subscribe', 'unsubscribe', 'answer'].includes(error.request)) {
      this.busy = false;
      this.busyFailures++;
      this.scheduleSync(Math.min(10_000, 1000 * 2 ** this.busyFailures));
      return;
    }

    // take_control, release_control, control_ready, and anything else worth showing.
    this.emitError({
      code: errorName(error.code),
      message: error.message,
      ...(error.deviceId ? { deviceId: error.deviceId } : {}),
    });
  }

  private async onOffer(message: SubscribeOffer): Promise<void> {
    // For the PeerConnection our pending offer replaces.
    if (this.ownOffers > 0) {
      return;
    }
    if (message.sessionReset) {
      this.resetPeer(true);
      this.offerDue = true;
    }
    const peer = this.pc;
    if (!peer) {
      return;
    }
    this.setSubscriptions(message.tracks);
    try {
      await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendRequest(this.socket, 'answer', { sdp: answer.sdp ?? '' });
    } catch (err) {
      console.warn('CloudflareRoom: the SFU offer did not apply, starting over =>', err);
      this.rebuildPeer();
      return;
    }
    this.attachTracks();
  }

  /**
   * Connects the PeerConnection with our own offer: the `server-events` channel puts an
   * m=application section in it. The SFU answers at once, so the PeerConnection connects while
   * the devices wake, and tracks come later with the SFU's offers. Data channels need it too.
   */
  private async connectEarly(): Promise<void> {
    const peer = this.pc;
    if (!peer) {
      return;
    }
    this.ownOffers += 1;
    try {
      peer.createDataChannel('server-events', { negotiated: true, id: 0 });
      await peer.setLocalDescription(await peer.createOffer());
    } catch (err) {
      this.ownOffers = Math.max(0, this.ownOffers - 1);
      console.warn('CloudflareRoom: could not create an offer =>', err);
      return;
    }
    if (peer !== this.pc || this.socket?.readyState !== WebSocket.OPEN) {
      this.ownOffers = Math.max(0, this.ownOffers - 1); // replaced or disconnected meanwhile: not sent
      return;
    }
    sendRequest(this.socket, 'offer', { sdp: peer.localDescription?.sdp ?? '' });
  }

  /**
   * A device went live, so the SFU is reachable. A PeerConnection made during an SFU outage may
   * never connect, even while its ICE checks go on, and would only fail after about 15 s. Give
   * it a few seconds, then start over.
   */
  private checkConnects() {
    if (this.connectCheck || !this.pc || this.pc.connectionState === 'connected') {
      return;
    }
    const peer = this.pc;
    this.connectCheck = setTimeout(() => {
      this.connectCheck = undefined;
      if (peer === this.pc && this.ownOffers === 0 && peer.connectionState !== 'connected') {
        this.rebuildPeer();
      }
    }, CONNECT_GRACE_MS);
  }

  /**
   * Starts over with a new PeerConnection after the last one failed, e.g. the SFU was out of
   * reach for a while. Our offer gets it a new SFU session; requests for the old one are void,
   * and we subscribe again once it is answered. Control of devices stays with us.
   */
  private rebuildPeer() {
    clearTimeout(this.rebuildTimer);
    clearTimeout(this.connectCheck);
    this.connectCheck = undefined;
    this.busy = false;
    this.offerDue = false;
    if (this.leaving) {
      return;
    }
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.resetPeer(false); // joined starts over
      return;
    }
    console.debug('CloudflareRoom: starting over with a new PeerConnection.');
    this.resetPeer(true);
    void this.connectEarly();
  }

  private scheduleSync(delay: number) {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), delay);
  }

  /** Brings the subscriptions in line with the devices that are live. One request at a time. */
  private sync() {
    // The SFU holds a subscribe until the PeerConnection is connected, and the worker answers our
    // requests one at a time. So wait: a request stuck there would hold up a new offer.
    if (this.busy || this.ownOffers > 0 || this.pc?.connectionState !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    // Tracks from a publication that ended: the device slept, restarted or left.
    const stale = [...this.subscriptions].filter(([, sub]) => {
      const info = this.infos.get(sub.deviceId);
      return !info || info.state !== LIVE || info.generation !== sub.generation;
    });
    if (stale.length > 0) {
      this.send('tracks', 'unsubscribe', { mids: stale.map(([mid]) => mid) });
      return;
    }

    const now = Date.now();
    let nextRetry = Infinity;
    const due = (list: Map<string, Retry>, info: DeviceInfo) => {
      const retry = list.get(info.deviceId);
      if (!retry || retry.generation !== info.generation || retry.at <= now) {
        return true;
      }
      nextRetry = Math.min(nextRetry, retry.at);
      return false;
    };

    const wanted: { deviceId: string; trackName: string }[] = [];
    for (const info of this.infos.values()) {
      if (info.state !== LIVE || this.refused.get(info.deviceId)?.generation === info.generation || !due(this.retries, info)) {
        continue;
      }
      for (const trackName of info.tracks) {
        const has = [...this.subscriptions.values()].some(
          (sub) => sub.deviceId === info.deviceId && sub.trackName === trackName && sub.generation === info.generation,
        );
        if (!has) {
          wanted.push({ deviceId: info.deviceId, trackName });
        }
      }
    }
    if (wanted.length > 0) {
      this.send('tracks', 'subscribe', { tracks: wanted });
      return;
    }

    // Data channels come after the media, so they never hold up the first picture. A device that
    // published again gets new channels; subscribing again keeps its control.
    if (this.ipc) {
      const wantedData: string[] = [];
      for (const info of this.infos.values()) {
        if (info.state !== LIVE || !info.dataChannels || !due(this.dataRetries, info)) {
          continue;
        }
        const current = this.dataSubs.get(info.deviceId);
        if (current?.generation === info.generation) {
          continue;
        }
        // Close the old channels now, so their ids are free when the new ones arrive.
        if (current) {
          this.closeChannels(info.deviceId);
        }
        wantedData.push(info.deviceId);
      }
      if (wantedData.length > 0) {
        this.send('data', 'subscribe', { data: wantedData });
        return;
      }
    }
    if (nextRetry !== Infinity) {
      this.scheduleSync(nextRetry - now);
    }
  }

  private send(kind: 'tracks' | 'data', action: 'subscribe' | 'unsubscribe', message: DeepPartial<Subscribe> | DeepPartial<Unsubscribe>) {
    this.busy = true;
    this.pending = kind;
    sendRequest(this.socket, action, message);
  }

  private setSubscriptions(list: Subscription[]) {
    this.subscriptions.clear();
    for (const sub of list) {
      this.subscriptions.set(sub.mid, sub);
    }
  }

  /** Opens the channels the worker lists and closes the others. */
  private setData(list: DataSubscription[]) {
    const listed = new Set<string>();
    for (const entry of list) {
      listed.add(entry.deviceId);
      const ids = entry.channels.map((channel) => `${channel.label}:${channel.id}`).join(',');
      let current = this.dataSubs.get(entry.deviceId);
      if (current && (current.ids !== ids || current.generation !== entry.generation)) {
        this.closeChannels(entry.deviceId);
        current = undefined;
      }
      if (!current) {
        if (!this.pc) {
          continue;
        }
        current = { generation: entry.generation, ids, canReply: false, channels: new Map(), assemblers: [] };
        for (const spec of entry.channels) {
          current.channels.set(spec.label, this.openChannel(entry.deviceId, spec.label, spec.id, current));
        }
        this.dataSubs.set(entry.deviceId, current);
      }
      const granted = entry.canReply && !current.canReply;
      current.canReply = entry.canReply;
      if (granted) {
        void this.confirmControl(entry.deviceId, current);
      }
    }
    for (const deviceId of [...this.dataSubs.keys()]) {
      if (!listed.has(deviceId)) {
        this.closeChannels(deviceId);
      }
    }
    this.changed();
  }

  /** A device's channel, negotiated on the id the worker gave. */
  private openChannel(deviceId: string, label: string, id: number, owner: DataChannels): RTCDataChannel {
    const channel = this.pc!.createDataChannel(label, { negotiated: true, id, ...CHANNEL_INIT[label] });
    channel.binaryType = 'arraybuffer';
    // A body over 64 KiB arrives as a Stream of chunks on the same channel.
    const assembler = new StreamAssembler({
      onComplete: (result) => this.onMessage?.(deviceId, result.body),
    });
    owner.assemblers.push(assembler);
    channel.addEventListener('message', (event) => {
      try {
        const packet = Packet.decode(new Uint8Array(event.data as ArrayBuffer));
        const body = packet.raw ?? packet.ipc?.payload;
        if (body !== undefined) {
          this.onMessage?.(deviceId, body);
        } else {
          assembler.receive(packet);
        }
      } catch (err) {
        console.warn(`CloudflareRoom: an unreadable message from ${deviceId} =>`, err);
      }
    });
    channel.addEventListener('open', () => {
      if (label === '_reliable' && this.dataSubs.get(deviceId) === owner && this.pendingTakes.delete(deviceId)) {
        sendRequest(this.socket, 'takeControl', { deviceId });
      }
      this.changed();
    });
    channel.addEventListener('close', () => this.changed());
    return channel;
  }

  private closeChannels(deviceId: string) {
    const current = this.dataSubs.get(deviceId);
    this.dataSubs.delete(deviceId);
    for (const channel of current?.channels.values() ?? []) {
      channel.close();
    }
    for (const assembler of current?.assemblers ?? []) {
      assembler.reset();
    }
    if (current) {
      this.changed();
    }
  }

  /** Tells the worker the takeover is done once the channels can carry our messages. */
  private async confirmControl(deviceId: string, current: DataChannels) {
    const reliable = current.channels.get('_reliable');
    if (reliable && reliable.readyState !== 'open') {
      await new Promise<void>((resolve) => {
        const done = () => {
          reliable.removeEventListener('open', done);
          reliable.removeEventListener('close', done);
          resolve();
        };
        reliable.addEventListener('open', done);
        reliable.addEventListener('close', done);
      });
    }
    if (this.dataSubs.get(deviceId) === current && current.canReply && reliable?.readyState === 'open') {
      sendRequest(this.socket, 'controlReady', { deviceId });
    }
  }

  private resetPeer(create: boolean) {
    for (const deviceId of [...this.dataSubs.keys()]) {
      this.closeChannels(deviceId);
    }
    this.pc?.close();
    this.pc = null;
    this.subscriptions.clear();
    if (this.streams.size > 0) {
      this.streams.clear();
      this.changed();
    }
    if (!create) {
      return;
    }
    const peer = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    this.pc = peer;
    peer.addEventListener('track', (event) => {
      if (peer !== this.pc) {
        return;
      }
      this.applyJitterBufferTarget(event.receiver);
      this.attachTracks();
    });
    peer.addEventListener('connectionstatechange', () => {
      if (peer !== this.pc) {
        return;
      }
      console.debug(`CloudflareRoom: peer ${peer.connectionState}`);
      if (peer.connectionState === 'connected') {
        this.sync();
      }
      // ICE gave up. "disconnected" may still recover on its own; "failed" does not.
      if (peer.connectionState === 'failed') {
        this.rebuildPeer();
      }
    });
  }

  /** Groups the received tracks by the device they came from, matched by mid. */
  private attachTracks() {
    const byDevice = new Map<string, MediaStreamTrack[]>();
    for (const transceiver of this.pc?.getTransceivers() ?? []) {
      const sub = transceiver.mid ? this.subscriptions.get(transceiver.mid) : undefined;
      const track = transceiver.receiver.track;
      if (!sub || !track) {
        continue;
      }
      const tracks = byDevice.get(sub.deviceId) ?? [];
      tracks.push(track);
      byDevice.set(sub.deviceId, tracks);
    }
    let changed = false;
    for (const deviceId of new Set([...this.streams.keys(), ...byDevice.keys()])) {
      const tracks = byDevice.get(deviceId) ?? [];
      const current = this.streams.get(deviceId)?.getTracks() ?? [];
      const same = current.length === tracks.length && tracks.every((track) => current.includes(track));
      if (same) {
        continue;
      }
      changed = true;
      if (tracks.length > 0) {
        this.streams.set(deviceId, new MediaStream(tracks));
      } else {
        this.streams.delete(deviceId);
      }
    }
    if (changed) {
      this.changed();
    }
  }

  private applyJitterBufferTarget(receiver: RTCRtpReceiver) {
    if (this.jitterBufferTarget === undefined || !('jitterBufferTarget' in receiver)) {
      return;
    }
    try {
      receiver.jitterBufferTarget = this.jitterBufferTarget;
    } catch (err) {
      console.warn('Failed to apply jitterBufferTarget:', err);
    }
  }

  private snapshot(info: DeviceInfo): RoomDevice {
    const control: RoomControl = {
      controller: viewer(info.controller),
      handover: viewer(info.handover),
      waiting: info.waiting.map((ref) => viewer(ref)!),
      mine: sameViewer(info.controller, this.me),
      takingOver: sameViewer(info.handover, this.me),
      inLine: info.waiting.some((ref) => sameViewer(ref, this.me)),
    };
    const refused = this.refused.get(info.deviceId);
    const error = refused && refused.generation === info.generation && info.state === LIVE
      ? errorName(refused.code)
      : info.lastError
        ? errorName(info.lastError)
        : undefined;
    return {
      deviceId: info.deviceId,
      state: stateName(info.state),
      generation: info.generation,
      tracks: [...info.tracks],
      stream: this.streams.get(info.deviceId),
      ...(error ? { error } : {}),
      ipc: info.dataChannels,
      control,
      canSend: this.canSend(info.deviceId),
    };
  }
}
