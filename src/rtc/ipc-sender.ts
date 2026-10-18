import { Packet } from "../proto/packet";
import { generateRequestId, yieldToEventLoop } from "../utils/rtc-tools";
import { IpcMode, IpcOptions, ipcBody } from "../peer/rtc-peer";

/** At or under this goes flat in `Packet.raw`. Matches the device's `kStreamChunkSize`. */
export const IPC_FLAT_LIMIT = 64 * 1024;

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

/** False if the channel is not open. */
function sendOn(channel: RTCDataChannel | undefined, data: Uint8Array<ArrayBuffer>): boolean {
  if (channel?.readyState !== 'open') {
    console.warn(`Cannot send on '${channel?.label ?? 'a missing channel'}': channel is not open.`);
    return false;
  }
  channel.send(data);
  return true;
}

/**
 * Sends an IPC payload the way the device's IpcChannel reads it: flat in `Packet.raw` (or
 * `Packet.ipc` with an endpoint) up to IPC_FLAT_LIMIT, as a Stream beyond that.
 */
export function sendIpc(
  channel: RTCDataChannel | undefined,
  binary: Uint8Array,
  mode: IpcMode,
  options?: IpcOptions,
): void {
  if (binary.length <= IPC_FLAT_LIMIT) {
    sendOn(channel, Packet.encode(Packet.create(ipcBody(binary, options))).finish());
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

  sendChunked(channel, binary).catch((err) => {
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
async function sendChunked(channel: RTCDataChannel | undefined, binary: Uint8Array): Promise<void> {
  if (channel?.readyState !== 'open') {
    console.warn(`Cannot send IPC payload: the '${channel?.label ?? 'IPC'}' channel is not open.`);
    return;
  }

  const streamId = generateRequestId();
  const total = binary.length;

  const header = Packet.create({
    stream: { streamId, header: { totalLength: total, mimeType: "application/octet-stream" } }
  });
  if (!sendOn(channel, Packet.encode(header).finish())) {
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
    if (!sendOn(channel, Packet.encode(chunk).finish())) {
      return;
    }
  }

  // The device's IpcChannel completes on the trailer, not the byte count, so this is required.
  const trailer = Packet.create({ stream: { streamId, trailer: { reason: "" } } });
  sendOn(channel, Packet.encode(trailer).finish());
}
