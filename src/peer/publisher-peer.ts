import { DataPacket_Kind, UserPacket, DataPacket } from '@livekit/protocol';
import {
  ChannelRole,
  IpcMode,
  IpcOptions,
  ipcBody,
  ipcModeToRole,
  roleInit,
  RtcPeer,
  RtcPeerConfig,
} from "./rtc-peer";
import { Packet } from '../proto/packet';

export class PublisherPeer extends RtcPeer {

  constructor(config: RtcPeerConfig) {
    super(config);

    // LiveKit opens channels in-band, and on the SFU path the publisher is the side that opens
    // them — so these are created here, not negotiated.
    this.registerChannel(
      ChannelRole.Reliable,
      super.createDataChannel(ChannelRole.Reliable, roleInit(ChannelRole.Reliable))
    );
    this.registerChannel(
      ChannelRole.Lossy,
      super.createDataChannel(ChannelRole.Lossy, roleInit(ChannelRole.Lossy))
    );

    console.debug("PublisherPeer created.");
  }

  sendText = (msg: string, mode: IpcMode = 'reliable') => {
    this.sendData(new TextEncoder().encode(msg), mode);
  }

  sendData = (binary: Uint8Array, mode: IpcMode = 'reliable') => {
    this.sendToEndpoint(binary, mode);
  }

  /**
   * @internal Addressed send, for whatever encodes for a named endpoint. `to` names the
   * participants that get it; everyone in the room does without it.
   */
  sendToEndpoint = (binary: Uint8Array, mode: IpcMode = 'reliable', options?: IpcOptions, to?: string[]) => {
    const data = Packet.encode(Packet.create(ipcBody(binary, options))).finish();

    const packet = new DataPacket({
      kind: mode === 'lossy' ? DataPacket_Kind.LOSSY : DataPacket_Kind.RELIABLE,
      destinationIdentities: to ?? [],
      value: {
        case: 'user',
        value: new UserPacket({
          payload: data,
          topic: 'ipc_topic',
          destinationIdentities: to ?? [],
        })
      }
    });

    this.sendOn(ipcModeToRole(mode), new Uint8Array(packet.toBinary()));
  }
}
