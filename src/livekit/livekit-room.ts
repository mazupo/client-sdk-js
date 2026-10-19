import { SfuRoom } from '../connection/sfu-room';
import { DEFAULT } from '../constants';
import { PublisherPeer } from '../peer/publisher-peer';
import { IpcMode, IpcOptions, RtcPeer, RtcPeerConfig } from '../peer/rtc-peer';
import { SubscriberPeer } from '../peer/subscriber-peer';
import { LiveKitClient, Participant, Quality, RoomInfo, Speaking } from '../signaling/livekit-client';
import { LiveKitDevice, LiveKitRoomOptions, LiveKitViewer } from './types';

/**
 * A LiveKit room, through a relay. Devices publish into it; this viewer
 * subscribes to them and sends IPC over LiveKit's data channels. With `microphone` (the
 * default), viewers talk to each other: this viewer publishes its microphone, muted until
 * `toggleMic()`, and LiveKit sends everyone else's.
 */
export class LiveKitRoom extends SfuRoom<LiveKitDevice, LiveKitViewer> {
  /** The room's LiveKit sid and name. */
  onRoomInfo?: (room: RoomInfo) => void;
  /** Connection quality of the participants. */
  onQuality?: (quality: Quality[]) => void;
  /** Who is speaking, and how loud. */
  onSpeaking?: (speaking: Speaking[]) => void;

  private readonly url: string;
  private readonly apiKey: string;
  private readonly microphone: boolean;
  private client?: LiveKitClient;
  private publisher?: PublisherPeer;
  private subscriber?: SubscriberPeer;
  /** The other participants, by sid. */
  private readonly participants = new Map<string, Participant>();
  /** What each participant sends, by sid. */
  private readonly streams = new Map<string, MediaStream>();
  private emitQueued = false;

  constructor(options: LiveKitRoomOptions) {
    super(options, { timeout: DEFAULT.SIGNALING_TIMEOUT, isMicOn: false });
    if (!options.url || !options.apiKey) {
      throw new Error('LiveKitRoom needs url and apiKey.');
    }
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.microphone = options.microphone ?? true;
  }

  get devices(): LiveKitDevice[] {
    const devices: LiveKitDevice[] = [];
    for (const [sid, stream] of this.streams) {
      if (stream.getVideoTracks().length === 0) {
        continue;
      }
      const participant = this.participants.get(sid);
      devices.push({ deviceId: participant?.id ?? sid, sid, state: participant?.state ?? 'ACTIVE', stream });
    }
    return devices;
  }

  get viewers(): LiveKitViewer[] {
    const others = [...this.participants.values()]
      .filter((participant) => !this.streams.get(participant.sid)?.getVideoTracks().length)
      .map((participant): LiveKitViewer => ({
        viewerId: participant.id,
        sid: participant.sid,
        state: participant.state,
        me: false,
        stream: this.streams.get(participant.sid),
      }));
    return [{ viewerId: this.viewerId, me: true }, ...others];
  }

  protected open(): void {
    const client = new LiveKitClient({ url: this.url, apiKey: this.apiKey, roomId: this.roomId, viewerId: this.viewerId });
    this.client = client;

    client.onJoin = async (server) => {
      const config = (): RtcPeerConfig => ({
        options: this.peerOptions(),
        iceServers: [server],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      const publisher = new PublisherPeer(config());
      this.publisher = publisher;
      publisher.onIceCandidate = (ev) => {
        if (ev.candidate) {
          client.send('tricklePublisher', JSON.stringify(ev.candidate));
        }
      };
      publisher.onOffer = (offer) => client.send('offer', offer.sdp);
      publisher.onReconnectFailed = () => this.giveUp();

      const subscriber = new SubscriberPeer(config());
      this.subscriber = subscriber;
      subscriber.onMessage = (data, from) => this.onMessage?.(data, from ?? '');
      subscriber.onSfuStream = (sid, stream) => {
        this.streams.set(sid, stream);
        this.onStream?.(stream, this.participants.get(sid)?.id ?? sid);
        this.changed();
      };
      subscriber.onConnectionStateChange = (state) => this.onPeerState(state);
      subscriber.onIceCandidate = (ev) => {
        if (ev.candidate) {
          client.send('trickleSubscriber', JSON.stringify(ev.candidate));
        }
      };
      subscriber.onReconnectFailed = () => this.giveUp();

      // LiveKit takes a track only after addTrack, so the microphone is announced before the offer.
      if (this.microphone) {
        let announce = true;
        try {
          await publisher.createlocalAudioStream();
        } catch (err) {
          announce = false;
          if (this.publisher === publisher) {
            this.emitError({ code: 'microphone', message: `No microphone, so you can only listen: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
        if (this.publisher !== publisher) {
          return; // disconnected while the browser asked for the microphone
        }
        if (announce) {
          client.send('addAudioTrack', 'microphone');
        }
      }
      await publisher.createOffer();
    };

    client.onOffer = async (sdp) => {
      const answer = await this.subscriber?.createAnswer(sdp);
      if (answer) {
        client.send('answer', answer.sdp);
      }
    };
    client.onAnswer = async (sdp) => this.publisher?.setRemoteDescription(sdp);
    client.onPublisherIce = async (ice) => this.publisher?.addIceCandidate(ice);
    client.onSubscriberIce = async (ice) => this.subscriber?.addIceCandidate(ice);
    client.onParticipant = (list) => this.updateParticipants(list);
    client.onRoomInfo = (room) => this.onRoomInfo?.(room);
    client.onQuality = (quality) => this.onQuality?.(quality);
    client.onSpeaking = (speaking) => this.onSpeaking?.(speaking);
    client.onLeave = () => this.fail({ code: 'left', message: 'LiveKit ended this connection.' });
    client.connect();
  }

  protected close(): void {
    this.publisher?.close();
    this.subscriber?.close();
    this.publisher = undefined;
    this.subscriber = undefined;
    this.client?.disconnect();
    this.client = undefined;
    this.participants.clear();
    this.streams.clear();
    this.changed();
  }

  protected peers(): RtcPeer[] {
    return [this.subscriber, this.publisher].filter((peer): peer is SubscriberPeer | PublisherPeer => Boolean(peer));
  }

  protected override receivingPeer(): RtcPeer | undefined {
    return this.subscriber;
  }

  /** To everyone in the room, or only to `deviceIds`. */
  protected deliver(data: Uint8Array, mode: IpcMode, options?: IpcOptions, deviceIds?: string[]): boolean {
    if (!this.deliverable(mode, deviceIds)) {
      return false;
    }
    this.publisher!.sendToEndpoint(data, mode, options, deviceIds);
    return true;
  }

  protected deliverable(mode: IpcMode, deviceIds?: string[]): boolean {
    if (!this.publisher?.canSend(mode)) {
      return false;
    }
    if (!deviceIds) {
      return true;
    }
    const present = new Set(this.devices.map((device) => device.deviceId));
    return deviceIds.some((id) => present.has(id));
  }

  private giveUp(): void {
    this.fail({ code: 'reconnect_failed', message: 'The connection to LiveKit dropped and could not be restored.' });
  }

  private onPeerState(state: RTCPeerConnectionState): void {
    if (state === 'connected') {
      this.setStatus('connected');
    } else if ((state === 'disconnected' || state === 'failed') && this.status === 'connected') {
      this.setStatus('reconnecting');
    }
  }

  private updateParticipants(list: Participant[]): void {
    for (const participant of list) {
      if (participant.state === 'DISCONNECTED') {
        this.participants.delete(participant.sid);
        this.streams.delete(participant.sid);
      } else {
        this.participants.set(participant.sid, participant);
      }
    }
    this.changed();
  }

  /** Reports the lists once, after the current burst of changes. */
  private changed(): void {
    if (this.emitQueued) {
      return;
    }
    this.emitQueued = true;
    void Promise.resolve().then(() => {
      this.emitQueued = false;
      this.onDevices?.(this.devices);
      this.onViewers?.(this.viewers);
    });
  }
}
