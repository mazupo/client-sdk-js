# Snapshots

Take a still image from the device. With `datachannelOnly: true`, the device sends no video at all, so nothing is encoded or uploaded until you ask for the image. The image arrives base64-encoded, after every part of it is in.

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
  if (role === ChannelRole.Command) {
    camera.snapshot();
  }
};

camera.onSnapshot = (base64Image) => {
  console.log(base64Image);
  camera.terminate();
};

camera.connect();
```

`snapshot(quality)` takes a JPEG quality from `0` to `100`. The default is `30`.
