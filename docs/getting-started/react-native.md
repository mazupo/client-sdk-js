# React Native

Show live video from a pi-webrtc device in a React Native app.

## 1. Install

Install and set up [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) first. Then install both packages:

```bash
npm install react-native-webrtc @mazupo/client
```

## 2. Show the video

`registerGlobals()` must run once when the app starts, before you create any `MqttCamera`. The stream arrives as an `RNMediaStream`. Its `toURL()` gives the URL for `RTCView`.

```tsx
import React, { useEffect, useState } from 'react';
import { RTCView, registerGlobals } from 'react-native-webrtc';
import { MqttCamera, RNMediaStream } from '@mazupo/client';

registerGlobals();

export default function App() {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    const camera = new MqttCamera({
      deviceId: 'your-device-id',
      host: 'your.mqtt.cloud',
      port: 8084,
      username: 'hakunamatata',
      password: 'Wonderful',
      stunUrls: ['stun:stun1.l.google.com:19302'],
    });

    camera.onStream = (stream) => {
      setStreamUrl((stream as RNMediaStream).toURL());
    };

    camera.connect();

    return () => {
      camera.disconnect();
    };
  }, []);

  if (!streamUrl) {
    return null;
  }

  return <RTCView streamURL={streamUrl} style={{ flex: 1 }} />;
}
```

`deviceId` must match the `--uid` of the device, and the MQTT settings are for the broker that the device uses.

## Next steps

- [Guides](../guides/README.md): snapshots, recording, IPC messages and more.
- [MqttCamera](../reference/mqtt-camera.md): every option, event and method.
