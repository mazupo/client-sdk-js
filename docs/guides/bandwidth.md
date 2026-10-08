# Bandwidth

Limit how much video the device sends to a viewer. A small tile on a monitoring wall does not need full quality, and a lower bitrate saves cloud and mobile data.

The browser does not tell the device how big the video is on the screen. A 160×90 tile still gets the full stream. Set `maxBitrate` to cap it:

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8084,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
  maxBitrate: 500, // kbps
});

camera.onStream = (stream) => {
  document.querySelector('#videoElement').srcObject = stream;
};

camera.connect();
```

## What the device does

To stay under the cap, the device lowers the resolution first, and keeps the frame rate. In our test, with a 1080p, 60 fps camera on a Jetson Orin NX:

| `maxBitrate` | Video received |
| --- | --- |
| not set | 1920×1080, 60 fps |
| `2000` | 1920×1080, 60 fps, about 1.6 Mbps |
| `500` | 960×540, 60 fps, about 0.35 Mbps |

The scene was mostly still. A busy scene drops to a lower resolution sooner.

## Limits

- It works with `mqtt` only. There, each viewer has its own connection and encoder on the device. With `livekit` or `cloudflare`, all viewers share one stream: set `--max-bitrate` on the device instead.
- You set it when you connect. To change it, call `terminate()`, and connect again with the new value.
- The device's own `--max-bitrate` still applies. The lower of the two wins.

## How it works

The SDK adds `b=AS` and `b=TIAS` lines to the video part of the SDP that it sends to the device. The WebRTC engine on the device reads them as the most this viewer can receive.
