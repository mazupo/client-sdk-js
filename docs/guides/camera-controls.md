# Camera Controls

Change image controls, such as brightness and contrast, while the camera runs. This works only for libcamera cameras on a Raspberry Pi.

The controls apply only after the connection is up, so set them in `onStatus`. The full list of controls is `CameraControlId`.

```javascript
import { CameraControlId, MqttCamera } from '@mazupo/client';

const camera = new MqttCamera({
  deviceId: 'your-device-id',
  host: 'your.mqtt.cloud',
  port: 8084,
  username: 'hakunamatata',
  password: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

camera.onStatus = (status) => {
  if (status === 'connected') {
    camera.setCameraControl(CameraControlId.BRIGHTNESS, 0.1);
    camera.setCameraControl(CameraControlId.CONTRAST, 1.2);
  }
};

camera.connect();
```
