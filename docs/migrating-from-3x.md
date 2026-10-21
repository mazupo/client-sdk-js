# Migrating from 3.x to 4.0

4.0 replaces `PiCamera` with one class for each way to connect. All of them share one API for the status, IPC, gamepad, microphone and speaker.

| 3.x | 4.0 |
| --- | --- |
| `new PiCamera({ signaling: 'mqtt', ... })` | `new MqttCamera({ ... })` |
| `new PiCamera({ signaling: 'livekit', ... })` | `new LiveKitRoom({ ... })` |
| `new PiCamera({ signaling: 'cloudflare', ... })` | `new CloudflareRoom({ ... })`, with a [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker) |

## MQTT

### Options

| 3.x | 4.0 |
| --- | --- |
| `uid` | `deviceId` |
| `mqttHost` | `host` |
| `mqttPort` | `port` |
| `mqttPath` | `path` (still `/mqtt` by default) |
| `mqttProtocol` | `protocol` |
| `mqttUsername` | `username` |
| `mqttPassword` | `password` |
| `signaling` | Gone: the class says it. |

`stunUrls`, `turnUrls`, `turnUsername`, `turnPassword`, `timeout`, `datachannelOnly`, `isMicOn`, `isSpeakerOn`, `codec`, `maxBitrate` and `jitterBufferTarget` keep their names.

```javascript
// 3.x
const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPort: 8084,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
});

// 4.0
const camera = new MqttCamera({
  deviceId: 'your-custom-uid',
  host: 'your.mqtt.cloud',
  port: 8084,
  username: 'hakunamatata',
  password: 'Wonderful',
});
```

### Events and methods

| 3.x | 4.0 |
| --- | --- |
| `terminate()` | `disconnect()` |
| `getStatus()` | `status`, and `onStatus` for changes |
| `onConnectionState(state)` | `onStatus(status)`: `connecting`, `connected`, `reconnecting` or `closed` |
| `onTimeout()` | `onError({ code: 'timeout' })`, then `onStatus('closed')` |
| `onError(err: Error)` | `onError({ code, message })` |
| `onStream(stream)` and `onSfuStream(sid, stream)` | `onStream(stream, id)` |
| `onMessage(data)` | `onMessage(data, deviceId)` |
| `sendText()`, `sendData()`, `canSend()` | The same, and they return whether the message went out. |

Snapshots, recording, files and camera controls stay the same on `MqttCamera`.

## LiveKit

| 3.x | 4.0 |
| --- | --- |
| `livekitUrl` | `url` |
| `livekitKey` | `apiKey` |
| `livekitRoom` | `roomId` |
| `userId` | `viewerId` |
| `onSfuStream(sid, stream)` | `onDevices(devices)`, each with its `stream`, or `onStream(stream, deviceId)` |
| `onParticipant(list)` | `onDevices(devices)` and `onViewers(viewers)` |
| `onRoomInfo`, `onQuality`, `onSpeaking` | The same. |

```javascript
// 4.0
import { LiveKitRoom } from '@mazupo/client';

const room = new LiveKitRoom({ url: 'wss://api.mazupo.com', apiKey: 'APIWnQTs4tmUZvA', roomId: 'my-first-room' });
room.onDevices = (devices) => {
  video.srcObject = devices[0]?.stream ?? null;
};
room.connect();
```

New in 4.0: `sendTextTo(deviceId, text)` sends to one device, and `onMessage(data, deviceId)` says who sent a message.

## Gamepad

`attachGamepad()` and `IpcSink` are gone. Every connection has `gamepad()`:

```javascript
// 3.x
import { attachGamepad } from '@mazupo/client/gamepad';
const pad = attachGamepad(camera, { hz: 60 });

// 4.0
const pad = camera.gamepad({ hz: 60 });
```

The React hook takes the connection first: `useGamepad({ camera })` becomes `useGamepad(camera)`. See [Gamepad](guides/gamepad.md).

## Cloudflare

In 4.0, `CloudflareRoom` watches a whole room of devices through a [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker).

These are gone: the `apiUrl` and `apiKey` options of `PiCamera`, `refresh()`, `onDeviceSession`, and the `DeviceSession` and `ApiConnectionOptions` types.

### The device has to move too

The device needs a pi-webrtc version that uses a cf-sfu-worker, with `--cloudflare-room`. See [SFU: Cloudflare Realtime](https://mazupo.com/docs/pi-webrtc/signaling/sfu#cloudflare-realtime).

The worker has its own keys. The viewer key of the old device API does not work with it.

### Code

```javascript
// 3.x
const camera = new PiCamera({
  signaling: 'cloudflare',
  apiUrl: 'https://api.mazupo.com',
  apiKey: 'OLD_VIEWER_KEY',
  uid: 'your-custom-uid',
});
camera.onSfuStream = (trackName, stream) => {
  video.srcObject = stream;
};
camera.connect();

// 4.0
import { CloudflareRoom } from '@mazupo/client';

const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/sfu',
  apiKey: '-706d13ForZLHmv6FwARf9ZgEEfO78AattyxWhNoHFo',
  roomId: 'your-room',
});
room.onDevices = (devices) => {
  const device = devices.find((d) => d.deviceId === 'your-custom-uid');
  if (device && video.srcObject !== (device.stream ?? null)) {
    video.srcObject = device.stream ?? null;
  }
};
room.connect();
```

To watch only one device, put it in a room of its own: start the device with a room that no other device joins.

New tracks play without `refresh()`. With `ipc: true`, you can send messages to a device you control. See [Send messages to a device](guides/cloudflare.md#send-messages-to-a-device).
