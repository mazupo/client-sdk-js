import { SignalingClient, generateUUID } from './signaling-client';

export interface LiveKitConnectionOptions {
  /**
   * The LiveKit relay to dial, e.g. wss://picamera-hono.<account>.workers.dev.
   * Matches pi-webrtc's `--livekit-url`.
   */
  livekitUrl?: string;

  /**
   * Matches pi-webrtc's `--livekit-key`. Issued by LiveKit; the relay compares it against its
   * own LIVEKIT_API_KEY before it mints an access token.
   */
  livekitKey?: string;

  /** The room to join. Matches pi-webrtc's `--livekit-room`. */
  livekitRoom?: string;

  /** Becomes the LiveKit participant identity. A random uuid when omitted. */
  userId?: string;
}

export type LiveKitActionType = 'join' | 'offer' | 'answer' |
  'trickle' | 'addVideoTrack' | 'addAudioTrack' |
  'trackPublished' | 'leave' | 'close' | 'ping' |
  'tricklePublisher' | 'trickleSubscriber' |
  'roomInfo' | 'quality' | 'speaking' |
  'participant' | 'error' | 'info';

type TrickleTarget = 'PUBLISHER' | 'SUBSCRIBER';

interface ProxyMessage {
  action: LiveKitActionType;
  message: string;
}

export interface Participant {
  sid: string;
  id: string;
  state: 'JOINING' | 'JOINED' | 'ACTIVE' | 'DISCONNECTED';
}

export interface RoomInfo {
  sid: string;
  name: string;
}

export interface Quality {
  sid: string,
  score: number,
}

export interface Speaking {
  sid: string,
  level: number,
}

class TrickleResponse {
  target: TrickleTarget;
  candidateInit: RTCIceCandidateInit;

  constructor(data: { target: TrickleTarget, candidateInit: RTCIceCandidateInit }) {
    this.target = data.target;
    this.candidateInit = data.candidateInit;
  }

  static fromJson(jsonStr: string): TrickleResponse {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed.candidateInit === "string") {
      parsed.candidateInit = JSON.parse(parsed.candidateInit);
    }
    return new TrickleResponse(parsed);
  }
}

export class LiveKitClient implements SignalingClient<LiveKitClient, LiveKitActionType> {
  private url?: string;
  private livekitKey: string;
  private userId: string;
  private roomId: string;
  private client?: WebSocket;
  private pingInterval?: NodeJS.Timeout;

  onConnect?: (conn: LiveKitClient) => void;
  onJoin?: (server: RTCIceServer) => void;
  onOffer?: (offer: RTCSessionDescriptionInit) => void;
  onAnswer?: (answer: RTCSessionDescriptionInit) => void;
  onPublisherIce?: (ice: RTCIceCandidateInit) => void;
  onSubscriberIce?: (ice: RTCIceCandidateInit) => void;
  onRoomInfo?: (participant: RoomInfo) => void;
  onQuality?: (participant: Quality[]) => void;
  onSpeaking?: (participant: Speaking[]) => void;
  onParticipant?: (participant: Participant[]) => void;
  onTrackPublished?: () => void;
  onLeave?: () => void;

  constructor(options: LiveKitConnectionOptions) {
    this.url = options.livekitUrl;
    this.livekitKey = options.livekitKey ?? '';
    this.userId = options.userId ?? generateUUID();
    this.roomId = options.livekitRoom ?? '';
  }

  connect = () => {
    const params = new URLSearchParams({
      apiKey: this.livekitKey,
      userId: this.userId,
      roomId: this.roomId,
    });

    this.client = new WebSocket(`${this.url}/rtc?${params.toString()}`);

    this.client.onopen = () => {
      console.log('WebSocket Connected');
      this.onConnect?.(this);
    };

    this.client.onmessage = (event) => {
      this.handleMessage(event);
    };

    this.client.onclose = () => {
      console.log('WebSocket Disconnected');
      this.clearPingInterval();
    };

    this.client.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };
  }

  private handleMessage(event: MessageEvent) {
    let { action, message }: ProxyMessage = JSON.parse(event.data);

    if (action === 'join') {
      this.startPingInterval();
      this.onJoin?.(JSON.parse(message));
    } else if (action === 'offer') {
      const sdp: RTCSessionDescriptionInit = { type: "offer", sdp: message };
      this.onOffer?.(sdp);
    } else if (action === 'answer') {
      const sdp: RTCSessionDescriptionInit = { type: "answer", sdp: message };
      this.onAnswer?.(sdp);
    } else if (action === 'trickle') {
      const trickleResponse = TrickleResponse.fromJson(message);
      if (trickleResponse.target === 'PUBLISHER') {
        this.onPublisherIce?.(trickleResponse.candidateInit);
      } else if (trickleResponse.target === 'SUBSCRIBER') {
        this.onSubscriberIce?.(trickleResponse.candidateInit);
      }
    } else if (action === 'trackPublished') {
      this.onTrackPublished?.();
    } else if (action === 'roomInfo') {
      this.onRoomInfo?.(JSON.parse(message));
    } else if (action === 'quality') {
      this.onQuality?.(JSON.parse(message));
    } else if (action === 'speaking') {
      this.onSpeaking?.(JSON.parse(message));
    } else if (action === 'participant') {
      this.onParticipant?.(JSON.parse(message));
    } else if (action === 'leave') {
      this.clearPingInterval();
      this.onLeave?.();
    }
  }

  send = (action: LiveKitActionType, message: string = '') => {
    if (!this.isConnected()) {
      console.warn(`Publish ${action} failed: ws client is not connected.`);
      return;
    }

    let data: ProxyMessage = { action: action, message };
    this.client?.send(JSON.stringify(data));
  }

  disconnect = () => {
    if (!this.client) return;
    this.send('leave');
    console.debug(`Terminating websocket connection.`);
    this.client.close();
  }

  isConnected = (): boolean => this.client?.readyState === WebSocket.OPEN;

  private startPingInterval() {
    this.clearPingInterval();

    console.debug('start ping interval');
    this.pingInterval = setInterval(() => {
      this.send('ping');
    }, 5000);
  }

  private clearPingInterval() {
    console.debug('clearing ping interval');
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
  }
}
