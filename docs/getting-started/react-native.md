# React Native

Show live video from a pi-webrtc device in a React Native app.

## 1. Install

Install and set up [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) first. Then install both packages:

```bash
npm install react-native-webrtc @mazupo/client
```

## 2. Show the video

`registerGlobals()` must run once when the app starts, before you create any `PiCamera`. The stream arrives as an `RNMediaStream`. Its `toURL()` gives the URL for `RTCView`.

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

`uid` must match the `--uid` of the device, and the MQTT settings are for the broker that the device uses.

## Next steps

- [Guides](../guides/README.md): snapshots, recording, IPC messages and more.
- [Options](../reference/options.md): every option of `PiCamera`.
