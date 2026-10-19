// Stands in for the `mqtt` package in test/connections.test.ts (see build.js): a broker in memory.

type Handler = (...args: any[]) => void;

export class FakeMqttClient {
  static all: FakeMqttClient[] = [];
  connected = false;
  disconnected = true;
  subscribed: string[] = [];
  published: { topic: string; message: string }[] = [];
  ended = false;
  private handlers = new Map<string, Handler[]>();

  constructor(public options: any) {
    FakeMqttClient.all.push(this);
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: any[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  connect() {
    this.connected = true;
    this.disconnected = false;
    this.emit('connect');
  }

  subscribe(topics: string[], _options: unknown, callback: (err: Error | null) => void) {
    this.subscribed.push(...topics);
    callback(null);
  }

  publish(topic: string, message: string) {
    this.published.push({ topic, message });
  }

  end() {
    this.ended = true;
    this.connected = false;
    this.disconnected = true;
  }

  /** The device publishes on one of our topics. */
  deliver(kind: 'offer' | 'answer' | 'ice', message: unknown) {
    const topic = this.subscribed.find((t) => t.split('/')[1] === kind)!;
    this.emit('message', topic, { toString: () => JSON.stringify(message) });
  }
}

export default {
  connect(options: any) {
    return new FakeMqttClient(options);
  },
};
