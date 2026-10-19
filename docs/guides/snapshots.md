# Snapshots

Take a still image from the device. Snapshots need an `MqttCamera`. With `datachannelOnly: true`, the device sends no video until you ask. The image arrives base64-encoded.

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
  if (role === ChannelRole.Command) {
    camera.snapshot();
  }
};

camera.onSnapshot = (base64Image) => {
  console.log(base64Image);
  camera.disconnect();
};

camera.connect();
```

`snapshot(quality)` takes a JPEG quality from `0` to `100`. The default is `30`.
