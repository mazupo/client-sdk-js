# Camera Controls

Change image controls, such as brightness and contrast, while the camera runs. This works only for libcamera cameras on a Raspberry Pi.

The controls apply only after the connection is up, so set them in `onConnectionState`. The full list of controls is `CameraControlId`.

```javascript
import { CameraControlId, PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8084,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

camera.onConnectionState = (state) => {
  if (state === 'connected') {
    camera.setCameraControl(CameraControlId.BRIGHTNESS, 0.1);
    camera.setCameraControl(CameraControlId.CONTRAST, 1.2);
  }
};

camera.connect();
```
