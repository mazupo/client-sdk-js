# IPC Messages

Send data to a program on the device, and receive its answers. The device must run pi-webrtc with `--enable-ipc`. pi-webrtc passes the messages to a Unix socket on the device. See [IPC messages in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/integrations/ipc).

You choose the channel for each message:

- `reliable` (the default) sends the message again until it arrives.
- `lossy` may drop the message, but has less delay.

```javascript
import { ChannelRole, PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
  datachannelOnly: true,
});

camera.onDatachannel = (role) => {
  if (role === ChannelRole.Reliable) {
    camera.sendText('Hello! this is @mazupo/client!');
  }
};

camera.onMessage = (data) => {
  const text = new TextDecoder('utf-8').decode(data);
  console.log(text);
};

camera.connect();
```

Use `sendData()` to send binary data. Messages larger than 64 KB are split into parts, and only work on `reliable`. See [sendText](../reference/methods.md#sendtext).
