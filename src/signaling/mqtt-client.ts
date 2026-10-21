import mqtt, { MqttClient as MqttLibClient, IClientOptions, MqttProtocol } from 'mqtt';
import { SignalingClient, generateUUID } from './signaling-client';

export type MqttTopicType = 'offer' | 'answer' | 'ice';

export interface MqttClientOptions {
  /** The device's --uid: it prefixes the topics. */
  deviceId: string;
  host: string;
  port?: number;
  path: string;
  protocol: MqttProtocol;
  username?: string;
  password?: string;
}

export class MqttClient implements SignalingClient<MqttClient, MqttTopicType> {
  private options: MqttClientOptions;
  private clientId: string;
  private client: MqttLibClient;
  private readonly topics: MqttTopicType[] = ['offer', 'answer', 'ice'];

  public onConnect?: (conn: MqttClient) => void;
  public onError?: (err: Error) => void;
  public onIceCandidate?: (candidate: RTCIceCandidate) => void;
  public onAnswer?: (sdp: RTCSessionDescription) => void;
  public onOffer?: (sdp: RTCSessionDescription) => void;

  constructor(options: MqttClientOptions) {
    this.options = options;
    this.clientId = generateUUID();
    const connectionOptions: IClientOptions = {
      host: this.options.host,
      port: this.options.port,
      path: this.options.path,
      clientId: this.clientId,
      username: this.options.username,
      password: this.options.password,
      protocol: this.options.protocol,
      keepalive: 20,
      protocolVersion: 5,
      clean: true,
      manualConnect: true,
      reconnectPeriod: 3000,
    };

    this.client = mqtt.connect(connectionOptions);
  }

  connect = () => {
    this.client.on('connect', () => {
      console.debug(`MQTT connected to "${this.options.deviceId}" with clientId: ${this.clientId}`);

      const fullTopics = this.topics.map((t) => this.getFullTopic(t));
      this.client.subscribe(fullTopics, { qos: 2, nl: true }, (err) => {
        if (err) {
          console.error('MQTT subscription failed:', err);
          this.onError?.(err);
          return;
        }
        this.onConnect?.(this);
      });
    });

    this.client.on('message', (topic, message) => this.handleMessage(topic, message.toString()));

    this.client.on('reconnect', () => {
      console.debug(`MQTT reconnecting to "${this.options.deviceId}"...`);
    });

    this.client.on('close', () => {
      console.debug(`MQTT connection closed for "${this.options.deviceId}".`);
    });

    this.client.on('error', (err) => {
      console.error('MQTT client error:', err);
    });

    this.client.connect();
  }

  private handleMessage(topic: string, message: string) {
    switch (topic) {
      case this.getFullTopic('ice'):
        const iceCandidate: RTCIceCandidate = JSON.parse(message);
        this.onIceCandidate?.(iceCandidate);
        break;
      case this.getFullTopic('answer'):
        const answer: RTCSessionDescription = JSON.parse(message);
        this.onAnswer?.(answer);
        break;
      case this.getFullTopic('offer'):
        const offer: RTCSessionDescription = JSON.parse(message);
        this.onOffer?.(offer);
        break;
      default:
        console.warn(`Unknown topic: ${topic}`);
        return;
    }
  }

  send = (topic: MqttTopicType, message: string) => {
    if (!this.isConnected()) {
      console.warn(`Publish ${topic} failed: mqtt client is not connected.`);
      return;
    }

    const destination = `${this.getFullTopic(topic)}`;
    this.client.publish(destination, message);
  }

  disconnect = () => {
    if (this.client.disconnected) return;

    this.client.end(true);

    console.debug(`MQTT disconnected from "${this.options.deviceId}" with clientId: ${this.clientId}`);
  }

  isConnected = (): boolean => this.client.connected ?? false;

  private getFullTopic(topic: MqttTopicType): string {
    return `${this.options.deviceId}/${topic}/${this.clientId}`;
  }
}
