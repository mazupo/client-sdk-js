import { Packet } from "../proto/packet";
import { StreamAssembler } from "./datachannel-receiver";

/** Reads one `_lossy` or `_reliable` channel: a small body arrives flat, a large one as a Stream of chunks. */
export class IpcReceiver {
  private readonly assembler: StreamAssembler;

  constructor(
    private readonly onBody: (body: Uint8Array) => void,
    onProgress?: (received: number, total: number, requestId: string) => void,
  ) {
    this.assembler = new StreamAssembler({ onProgress, onComplete: (result) => onBody(result.body) });
  }

  receive(packet: Packet): void {
    const body = packet.raw ?? packet.ipc?.payload;
    if (body !== undefined) {
      this.onBody(body);
    } else {
      this.assembler.receive(packet);
    }
  }

  reset(): void {
    this.assembler.reset();
  }
}
