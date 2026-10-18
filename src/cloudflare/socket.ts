import {
  DeepPartial,
  DeviceState,
  ErrorCode,
  ViewerRequest,
  ViewerResponse,
} from '../proto/cloudflare';
import { DeviceStateName } from './types';

/** The worker answers "ping" with "pong" without waking its Durable Object. */
export const PING_INTERVAL_MS = 15_000;

export interface TokenBody {
  viewer_id: string;
  room_id: string;
  can_subscribe: true;
  data_channels?: true;
}

/** A 30 s, single-use access token and the WebSocket URL to use it on. */
export interface TokenResponse {
  token: string;
  url: string;
}

/** Trades the viewer public key for an access token. */
export async function requestToken(apiUrl: string, apiKey: string, body: TokenBody): Promise<TokenResponse> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/token`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error?.message ?? `The token request failed (${response.status}).`);
  }
  if (typeof json?.token !== 'string' || typeof json?.url !== 'string') {
    throw new Error('The token response has no token or url.');
  }
  return { token: json.token, url: json.url };
}

/**
 * Calls onTick every intervalMs. In a browser the timer runs in a dedicated worker: a hidden tab
 * runs its own timers only once a minute after a while, which is longer than the worker's 45 s
 * presence window. Elsewhere (React Native, Node) a plain interval.
 */
function startTicker(intervalMs: number, onTick: () => void): () => void {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    try {
      const source = `setInterval(() => postMessage(0), ${intervalMs});`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = onTick;
      return () => worker.terminate();
    } catch {
      // A page whose CSP blocks blob: workers. Fall through.
    }
  }
  const timer = setInterval(onTick, intervalMs);
  return () => clearInterval(timer);
}

/** Opens the socket and sends "ping" every 15 s. */
export function openSocket(url: string, token: string): WebSocket {
  const ws = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`);
  ws.binaryType = 'arraybuffer';
  const stop = startTicker(PING_INTERVAL_MS, () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('ping');
    }
  });
  ws.addEventListener('close', stop);
  return ws;
}

type RequestAction = keyof ViewerRequest;

/** Sends ViewerRequest { [action]: message } if the socket is open. Unset fields take defaults. */
export function sendRequest<A extends RequestAction>(
  ws: WebSocket | null,
  action: A,
  message?: DeepPartial<NonNullable<ViewerRequest[A]>>,
): void {
  if (ws?.readyState === WebSocket.OPEN) {
    const request = { [action]: message ?? {} } as DeepPartial<ViewerRequest>;
    ws.send(ViewerRequest.encode(ViewerRequest.fromPartial(request)).finish());
  }
}

/** One response, by the field that is set. */
export type ResponseFrame = {
  [A in keyof ViewerResponse]-?: { action: A; message: NonNullable<ViewerResponse[A]> }
}[keyof ViewerResponse];

/** Null for "pong" and for frames it cannot read. */
export function parseResponse(data: unknown): ResponseFrame | null {
  if (typeof data === 'string' || !(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
    return null;
  }
  try {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const decoded = ViewerResponse.decode(bytes);
    const entry = Object.entries(decoded).find(([, value]) => value !== undefined);
    return entry ? ({ action: entry[0], message: entry[1] } as ResponseFrame) : null;
  } catch {
    return null;
  }
}

/** DEVICE_STATE_LIVE -> "live" */
export function stateName(state: DeviceState): DeviceStateName {
  switch (state) {
    case DeviceState.DEVICE_STATE_OFFLINE:
      return 'offline';
    case DeviceState.DEVICE_STATE_SLEEPING:
      return 'sleeping';
    case DeviceState.DEVICE_STATE_WAKING:
      return 'waking';
    case DeviceState.DEVICE_STATE_LIVE:
      return 'live';
    default:
      return 'unknown';
  }
}

/** ERROR_CODE_VIEWER_LIMIT -> "viewer_limit" */
export function errorName(code: ErrorCode): string {
  return (ErrorCode[code] ?? 'unknown').replace('ERROR_CODE_', '').toLowerCase();
}
