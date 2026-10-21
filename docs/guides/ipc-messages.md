# IPC Messages

Send data to a program on the device and get its answers. The device runs pi-webrtc with `--enable-ipc`. See [IPC messages in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/integrations/ipc).

You choose the channel for each message:

- `reliable` (the default) sends the message again until it arrives.
- `lossy` may drop the message, but has less delay.

```javascript
import { ChannelRole, MqttCamera } from '@mazupo/client';

const camera = new MqttCamera({
  deviceId: 'your-device-id',
  host: 'your.mqtt.cloud',
  port: 8084,
  username: 'hakunamatata',
  password: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
  datachannelOnly: true,
});

camera.onDatachannel = (role) => {
  if (role === ChannelRole.Reliable) {
    camera.sendText('Hello! this is @mazupo/client!');
  }
};

camera.onMessage = (data, deviceId) => {
  const text = new TextDecoder('utf-8').decode(data);
  console.log(deviceId, text);
};

camera.connect();
```

Use `sendData()` to send binary data. Messages larger than 64 KB are split into parts, and only work on `reliable`. See [sendText](../reference/connection.md#sendtext).

In a room, `sendText()` goes to every device it can reach, and `sendTextTo(deviceId, text)` to one. See [LiveKit](livekit.md) and [Cloudflare Realtime](cloudflare.md#send-messages-to-a-device).
