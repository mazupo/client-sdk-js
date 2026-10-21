export interface SignalingClient<
  TClient,
  TAction = string
> {
  onConnect?: (conn: TClient) => void;
  connect: () => void;
  disconnect: () => void;
  send: (type: TAction, message: string) => void;
  isConnected: () => boolean;
}

/**
 * Generate a UUID v4.
 * Falls back to Math.random()-based UUID for environments that don't support crypto.randomUUID (e.g., React Native).
 * Compatible with both Web and React Native.
 */
export function generateUUID(): string {
  try {
    // Try native crypto API first (Web, Node.js with crypto polyfill)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (e) {
    // Fallback silently
  }

  // Fallback: generate UUID v4 using Math.random()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
