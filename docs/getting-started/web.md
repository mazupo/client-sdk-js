# Web

Show live video from a pi-webrtc device in a web page.

## 1. Install

```bash
npm install @mazupo/client
```

## 2. Create the page

This is a complete page. Open it, and the video appears when the device answers.

```html
<!DOCTYPE html>
<html lang="en">
  <body>
    <video id="videoElement" autoplay playsinline controls></video>
    <script type="module">
      import { PiCamera } from '@mazupo/client';

      const videoRef = document.getElementById('videoElement');
      const camera = new PiCamera({
        uid: 'your-custom-uid',
        mqttHost: 'your.mqtt.cloud',
        mqttPath: '/mqtt',
        mqttPort: 8884,
        mqttUsername: 'hakunamatata',
        mqttPassword: 'Wonderful',
        stunUrls: ['stun:stun1.l.google.com:19302'],
      });

      camera.onStream = (stream) => {
        videoRef.srcObject = stream ?? null;
      };

      camera.connect();
    </script>
  </body>
</html>
```

- `uid` must match the `--uid` of the device.
- The MQTT settings are for the broker that the device uses. `mqttPort` is the broker's WebSocket port, not the `8883` port of the device.

## Next steps

- [Guides](../guides/README.md): snapshots, recording, IPC messages and more.
- [Options](../reference/options.md): every option of `PiCamera`.
