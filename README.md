<p align=center>
    <img src="docs/icon.png" width="200" alt="JavaScript client SDK for pi-webrtc">
</p>
<h1 align="center">
    JavaScript client SDK for pi-webrtc
</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@mazupo/client"><img src="https://img.shields.io/npm/dt/@mazupo/client?color=yellow" alt="npm downloads"></a>
    <img src="https://img.shields.io/github/v/tag/mazupo/client-sdk-js?filter=v*&label=release&color=blue" alt="Release">
</p>

Web and React Native client for [pi-webrtc](https://github.com/mazupo/pi-webrtc), with TypeScript typings and support for low-latency WebRTC streaming, P2P, SFU, DataChannel control, snapshots, gamepad input, and file transfer.

- Live demo: [mazupo.github.io/client-sdk-js/demo](https://mazupo.github.io/client-sdk-js/demo/)
- Demo source: [demo/index.html](demo/index.html)

## Quick Start

### For Web

```bash
npm install @mazupo/client
```

```html
<video id="videoElement" autoplay playsinline controls></video>
<script type="module">
  import { PiCamera } from '@mazupo/client';

  const videoRef = document.getElementById('videoElement');
  const camera = new PiCamera({
    uid: 'your-custom-uid',
    mqttHost: 'your.mqtt.cloud',
    mqttPath: '/mqtt',
    mqttPort: 8084,
    mqttUsername: 'hakunamatata',
    mqttPassword: 'Wonderful',
    stunUrls: ['stun:stun1.l.google.com:19302'],
  });

  camera.onStream = (stream) => {
    videoRef.srcObject = stream ?? null;
  };

  camera.connect();
</script>
```

`uid` has to match the `--uid` the device was started with, and the MQTT settings are the broker
both sides talk to.

### For React Native

Install and configure [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc), then install `@mazupo/client`:

```bash
npm install react-native-webrtc @mazupo/client
```

`registerGlobals()` has to run once at app startup, before any `PiCamera` is created:

```tsx
import React, { useEffect, useState } from 'react';
import { RTCView, registerGlobals } from 'react-native-webrtc';
import { PiCamera, RNMediaStream } from '@mazupo/client';

registerGlobals();

export default function App() {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    const camera = new PiCamera({
      uid: 'your-custom-uid',
      mqttHost: 'your.mqtt.cloud',
      mqttPath: '/mqtt',
      mqttPort: 8084,
      mqttUsername: 'hakunamatata',
      mqttPassword: 'Wonderful',
      stunUrls: ['stun:stun1.l.google.com:19302'],
    });

    camera.onStream = (stream) => {
      setStreamUrl((stream as RNMediaStream).toURL());
    };

    camera.connect();

    return () => {
      camera.terminate();
    };
  }, []);

  if (!streamUrl) {
    return null;
  }

  return <RTCView streamURL={streamUrl} style={{ flex: 1 }} />;
}
```

## Documentation

📚 **[Full documentation](https://mazupo.com/docs/client-sdk-js)**, also readable in [docs/](docs/README.md).

- [Getting Started](docs/getting-started/README.md): the first video, on the web or in React Native.
- [Guides](docs/guides/README.md): one complete example for each task.
- [API Reference](docs/reference/README.md): options, events, methods, DataChannels and the gamepad.
- [Migrating from 2.x](docs/migrating-from-2x.md): renamed exports, the new wire protocol, and what it means for your device.

## Examples

- [Live video in a browser](docs/getting-started/web.md): the full HTML page behind the Quick Start above.
- [Live video in React Native](docs/getting-started/react-native.md): `RTCView` with `registerGlobals()`.
- [Trade buffering for latency](docs/guides/latency.md): `jitterBufferTarget` and how to measure it.
- [Cap the bitrate](docs/guides/bandwidth.md): `maxBitrate` for small tiles and metered links.
- [Take a snapshot](docs/guides/snapshots.md): a still image over the command DataChannel, with no video stream.
- [Send and receive IPC messages](docs/guides/ipc-messages.md): talk to a process on the device.
- [Drive a device with a gamepad](docs/guides/gamepad.md): read a controller and send each reading to the device, in JavaScript or React.
- [Start and stop recording, and download a file](docs/guides/recording.md): drive the device's on-demand recorder.
- [Adjust camera controls](docs/guides/camera-controls.md): brightness, contrast, and the rest of `CameraControlId`.
- [Play through the LiveKit SFU](docs/guides/livekit.md): many viewers, one uplink.
- [Pull from the Cloudflare Realtime SFU](docs/guides/cloudflare.md): the same, with nothing to host.

# License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full terms,
and [NOTICE](NOTICE) for the third-party components the published bundles include.
