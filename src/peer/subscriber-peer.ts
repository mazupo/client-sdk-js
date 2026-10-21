import { DataPacket } from "@livekit/protocol";
import { Packet } from "../proto/packet";
import { IpcReceiver } from "../rtc/ipc-receiver";
import { ChannelRole, RtcPeer, RtcPeerConfig } from "./rtc-peer";

export class SubscriberPeer extends RtcPeer {
  /** One per channel and sender: everyone's messages share the SFU's channels. */
  private readonly senders = new Map<string, IpcReceiver>();

  constructor(config: RtcPeerConfig) {
    super(config);
    console.debug("SubscriberPeer created.");
  }

  /** LiveKit names a stream `<participantSid>|<trackSid>`, so a participant is one stream. */
  protected override getStreamKey(event: RTCTrackEvent): string {
    const [sid] = (event.streams[0]?.id ?? '').split('|');
    return sid || super.getStreamKey(event);
  }

  override close() {
    this.senders.forEach((receiver) => receiver.reset());
    this.senders.clear();
    super.close();
  }

  override async onDataChannelMessage(role: ChannelRole, event: MessageEvent): Promise<void> {
    let buffer: ArrayBuffer;
    if (event.data instanceof ArrayBuffer) {
      buffer = event.data;
    } else if (event.data instanceof Blob) {
      buffer = await event.data.arrayBuffer();
    } else {
      console.error('unsupported data type', event.data);
      return;
    }

    const dp = DataPacket.fromBinary(new Uint8Array(buffer));
    if (dp.value?.case !== 'user' || (role !== ChannelRole.Lossy && role !== ChannelRole.Reliable)) {
      return;
    }

    const user = dp.value.value;
    const from = dp.participantIdentity || user.participantIdentity;
    const key = `${role}:${from}`;
    let receiver = this.senders.get(key);
    if (!receiver) {
      receiver = new IpcReceiver((body) => this.onMessage?.(body, from || undefined));
      this.senders.set(key, receiver);
    }
    receiver.receive(Packet.decode(user.payload));
  }
}
