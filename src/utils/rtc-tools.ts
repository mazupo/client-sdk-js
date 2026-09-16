export type CodecType = 'H264' | 'VP8' | 'VP9' | 'AV1';

/**
 * Convert an ArrayBuffer to a string.
 * @param {Uint8Array} buffer - The ArrayBuffer to convert.
 * @returns {string} - The resulting string.
 */
export function arrayBufferToString(buffer: Uint8Array): string {
  return buffer.reduce((acc, curr) => acc + String.fromCharCode(curr), "");
}

/**
 * Convert an ArrayBuffer to a string.
 * @param {string} str - The string to convert.
 * @returns {Uint8Array} - The resulting Uint8Array.
 */
export function stringToArrayBuffer(str: string): Uint8Array {
  const buffer = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buffer[i] = str.charCodeAt(i);
  }
  return buffer;
}

/**
 * Convert an ArrayBuffer to a Base64 string.
 * @param {Uint8Array} buffer - The ArrayBuffer to convert.
 * @returns {string} - The resulting Base64 string.
 */
export function arrayBufferToBase64(buffer: Uint8Array): string {
  return btoa(arrayBufferToString(buffer));
}

// One channel for the whole module: yielding happens every few milliseconds on a busy
// transfer, and a fresh MessageChannel per yield would be pure garbage.
let yieldPort: MessagePort | undefined;
const yieldWaiters: Array<() => void> = [];

/**
 * Hand control back to the event loop, without setTimeout's nested-timer clamping.
 *
 * One waiter is released per message, so two callers yielding at the same time resume in
 * separate tasks. Releasing them together would let their time slices add up into one long
 * task, which is the opposite of what yielding is for.
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (!yieldPort) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => yieldWaiters.shift()?.();
    yieldPort = channel.port2;
    // A live port keeps a Node process from exiting; browsers have no unref.
    (channel.port1 as MessagePort & { unref?: () => void }).unref?.();
    (yieldPort as MessagePort & { unref?: () => void }).unref?.();
  }

  return new Promise((resolve) => {
    yieldWaiters.push(resolve);
    yieldPort!.postMessage(null);
  });
}

export const padZero = (num: number): string => {
  return num.toString().padStart(2, '0');
}

/** Past this the browser throws a RangeError, so a target is clamped before it gets there. */
export const MAX_JITTER_BUFFER_TARGET_MS = 4000;

/** `null` means "no application preference"; anything unusable becomes that rather than throwing. */
export function clampJitterBufferTarget(target: number | null): number | null {
  if (target === null) {
    return null;
  }

  if (!Number.isFinite(target)) {
    console.warn(`Ignoring a jitterBufferTarget of ${target}: not a finite number.`);
    return null;
  }

  const clamped = Math.min(Math.max(target, 0), MAX_JITTER_BUFFER_TARGET_MS);
  if (clamped !== target) {
    console.warn(
      `Clamped a jitterBufferTarget of ${target}ms to ${clamped}ms; ` +
      `the allowed range is 0-${MAX_JITTER_BUFFER_TARGET_MS}ms.`
    );
  }
  return clamped;
}

/**
 * A correlation id for a request, or a stream id for a chunked body. `crypto.randomUUID()` needs a
 * secure context and is missing from some React Native runtimes, hence the fallbacks.
 */
export function generateRequestId(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Version 4 and variant bits, so the result is a well-formed UUID either way.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }

  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}
