import type { MqttProtocol } from 'mqtt';

import type { ConnectionOptions } from '../connection/types';
import type { CodecType } from '../utils/rtc-tools';

export interface MqttCameraOptions extends ConnectionOptions {
  /** The device's id: pi-webrtc's `--uid`. It prefixes the signaling topics. */
  deviceId: string;

  /** The MQTT broker. */
  host: string;
  port?: number;
  /** `/mqtt` by default. */
  path?: string;
  /** `wss` by default. */
  protocol?: MqttProtocol;
  username?: string;
  password?: string;

  stunUrls?: string[];
  turnUrls?: string[];
  turnUsername?: string;
  turnPassword?: string;

  /** Only the data channels: no video or audio. */
  datachannelOnly?: boolean;

  /** The video codec to ask the device for. */
  codec?: CodecType;

  /**
   * The most video bitrate the device may send to this viewer, in kbps. Each viewer has its own
   * connection and encoder on the device. The device lowers the resolution first to stay under
   * it, and keeps the frame rate. Set when connecting; to change it, connect again.
   */
  maxBitrate?: number;
}
