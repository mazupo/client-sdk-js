# Examples

- [Live video in a browser](#live-video-in-a-browser)
- [Live video in React Native](#live-video-in-react-native)
- [Trade buffering for latency](#trade-buffering-for-latency)
- [Take a snapshot](#take-a-snapshot)
- [Send and receive IPC messages](#send-and-receive-ipc-messages)
- [Drive a device with a gamepad](#drive-a-device-with-a-gamepad)
- [Gamepad in React](#gamepad-in-react)
- [Download a recorded video](#download-a-recorded-video)
- [Adjust camera controls](#adjust-camera-controls)
- [Start and stop recording](#start-and-stop-recording)
- [Play through the LiveKit SFU](#play-through-the-livekit-sfu)
- [Pull from the Cloudflare Realtime SFU](#pull-from-the-cloudflare-realtime-sfu)

Each snippet stands on its own. `uid` has to match the `--uid` the device was started with, and
the MQTT settings are the broker both sides talk to. Every option, event, and method is listed in the
[API documentation](API.md).

## Live video in a browser

A complete page: open it, and the stream appears once the device answers.

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

## Live video in React Native

`registerGlobals()` from `react-native-webrtc` has to run once before any `PiCamera` is created.
The stream arrives as an `RNMediaStream`, whose `toURL()` feeds `RTCView`.

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
      mqttPort: 8884,
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

## Trade buffering for latency

The browser buffers a few hundred milliseconds before playing, which is wasted on a LAN. `jitterBufferTarget` says how much to aim for: lower means less delay but more freezes.

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
  jitterBufferTarget: 10,
});

camera.onStream = (stream) => {
  document.querySelector('#videoElement').srcObject = stream;
};

camera.connect();

// Back off once the network turns out to be worse than hoped.
document.querySelector('#buffer').oninput = (event) => {
  camera.setJitterBufferTarget(Number(event.target.value));
};
```

The browser converges on the target over several seconds, so `getStats()` is what says how much is really being held. `freezeCount` is the other half of the trade.

```javascript
let last = null;

setInterval(async () => {
  const report = await camera.getStats();

  report?.forEach((stat) => {
    if (stat.type !== 'inbound-rtp' || stat.kind !== 'video') {
      return;
    }
    if (last && stat.jitterBufferEmittedCount > last.count) {
      const ms = (stat.jitterBufferDelay - last.delay) /
        (stat.jitterBufferEmittedCount - last.count) * 1000;
      console.log(`buffered ${ms.toFixed(0)}ms, ${stat.freezeCount} freezes`);
    }
    last = { delay: stat.jitterBufferDelay, count: stat.jitterBufferEmittedCount };
  });
}, 2000);
```

## Take a snapshot

`datachannelOnly: true` skips the media stream entirely, so nothing is encoded or uploaded until the snapshot is asked for. The image arrives base64-encoded once every packet is in.

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

## Send and receive IPC messages

Talks to whatever process the device has on the other end of `--enable-ipc`. Both IPC channels are open whenever the device runs with that flag, so the mode is picked per message: `sendText(msg, 'reliable')` (the default) retransmits until delivered, `'lossy'` gives up sooner for lower latency.

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

## Drive a device with a gamepad

Reads a controller and sends each reading to the device's `gamepad` endpoint. The device needs
**both** `--enable-ipc` and `--enable-gamepad`: the first opens the channels this arrives on,
the second opens the socket it is routed to. Without the second, input is sent and silently
discarded.

Readings go out on the lossy channel. Attach before or after `connect()`, it makes no difference:
nothing is sent until that channel is open, and it stops again when the connection ends. The loop
keeps running either way, which is what `onSnapshot` and `onButton` are reading.

```javascript
import { PiCamera } from '@mazupo/client';
import { attachGamepad, Button } from '@mazupo/client/gamepad';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

const pad = attachGamepad(camera, { hz: 60 });

// null when no controller is reporting.
pad.onSnapshot((snapshot) => {
  console.log(snapshot?.leftX, snapshot?.leftY);
});

// Fires once per press and once per release, never while the button is held.
pad.onButton(Button.A, (pressed) => {
  if (pressed) camera.snapshot();
});

camera.connect();
```

## Gamepad in React

`useGamepad` runs a sampler for the life of the component and `<GamepadView>` draws it. Only
`connected` and `suspended` reach React state — readings arrive 60 times a second and go
straight to the view, so a moving stick re-renders that component and nothing above it.

```tsx
import { PiCamera } from '@mazupo/client';
import { GamepadView, useGamepad } from '@mazupo/client/gamepad/react';

// Pass the camera as soon as it exists; null before there is one.
function Controller({ camera }: { camera: PiCamera | null }) {
  const { connected, suspended, sampler } = useGamepad({ camera, hz: 60 });

  if (!connected) {
    return <p>Press any button on your gamepad</p>;
  }

  return (
    <>
      <GamepadView sampler={sampler} />
      {suspended && <p>Input paused ({suspended})</p>}
    </>
  );
}
```

`react` is an optional peer dependency, needed only for this entry point.

## Download a recorded video

Fetches the recording list, downloads the newest file, and hands it to the browser as a normal download. `onProgress` fires as the bytes come in over the DataChannel.

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  datachannelOnly: true,
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

camera.onDatachannel = () => {
  camera.fetchVideoList();
};

camera.onVideoListLoaded = (res) => {
  camera.downloadVideoFile(res.files[0].filepath);
};

camera.onProgress = (received, total, type) => {
  console.log('progress', { received, total, type });
};

camera.onVideoDownloaded = (file) => {
  const blob = new Blob([file], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = 'video_filename.mp4';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  camera.terminate();
};

camera.connect();
```

## Adjust camera controls

Controls only apply once the peer is up, so set them from `onConnectionState`. The full list of ids is `CameraControlId`. It only works for libcamera sources.

```javascript
import { CameraControlId, PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
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

## Start and stop recording

Drives the device's on-demand recorder over the command DataChannel, so the device needs `--record-mode=on-demand` (or `both`). Recording runs until you call `stopRecording()` — nothing ends the clip on its own. `onRecording` reports each state change and the file being written.

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
    camera.startRecording();

    // Nothing stops the recorder by itself. Here a 10s timer stands in for whatever ends the
    // clip in your app — a button, a motion event, a page unload.
    setTimeout(() => camera.stopRecording(), 10000);
  }
};

camera.onRecording = (res) => {
  console.log('isRecording:', res.isRecording);
  console.log('filepath:', res.filepath);
};

camera.connect();
```

## Play through the LiveKit SFU

Everyone who joins the room sees the same stream, so the device's uplink carries one copy no matter how many are watching. `onSfuStream` gives the publisher's sid alongside the stream.

```javascript
import { PiCamera } from '@mazupo/client';

const videoRef = document.getElementById('videoElement');
const camera = new PiCamera({
  signaling: 'livekit',
  livekitUrl: 'wss://api.mazupo.com',
  livekitKey: 'APIWnQTs4tmUZvA',
  livekitRoom: 'my-first-room',
});

camera.onSfuStream = (_sid, stream) => {
  if (videoRef instanceof HTMLVideoElement) {
    videoRef.srcObject = stream;
  }
};

camera.connect();
```

## Pull from the Cloudflare Realtime SFU

Cloudflare has no participants, so `onSfuStream` hands over a **track name** instead of a sid.
The device's session id changes on every reconnect, which is why a viewer looks the device up by `uid` rather than holding a session.

```javascript
import { PiCamera } from '@mazupo/client';

// Pulls whatever the device is publishing into a Cloudflare Realtime SFU. The App ID and Secret
// stay on the device API, so a browser only ever needs its own viewer key.
const videoRef = document.getElementById('videoElement');
const camera = new PiCamera({
  signaling: 'cloudflare',
  apiUrl: 'https://api.mazupo.com',
  apiKey: 'your-viewer-api-key',
  uid: 'your-custom-uid',
});

// A device may publish more than one track; each arrives under the name it was published with.
camera.onSfuStream = (trackName, stream) => {
  console.log(`pulled ${trackName}`);
  if (videoRef instanceof HTMLVideoElement) {
    videoRef.srcObject = stream;
  }
};

camera.onError = (err) => {
  console.error(err.message);
};

camera.connect();

// The device may start publishing more tracks later on; nothing pulls them in on its own.
// camera.refresh();
```

For SFU deployment on the device side, see
[Broadcasting a Live Stream to Many Viewers via SFU](https://github.com/mazupo/pi-webrtc/blob/main/docs/ADVANCED.md#broadcasting-a-live-stream-to-many-viewers-via-sfu).

---

Back to the [README](../README.md).
