# LiveKit

Watch through a LiveKit SFU. Everyone in the room sees the same stream, so the device uploads one copy, no matter how many people watch.

The example below uses the free test server. First, start the device in the same room, as shown in [SFU: LiveKit](https://mazupo.com/docs/pi-webrtc/signaling/sfu#livekit) in the pi-webrtc docs. That page also lists the limits of the test server, and how to use your own.

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

`onSfuStream` gives the publisher's id (`sid`) with the stream.

Over LiveKit, only the IPC channels work: `sendText()`, `sendData()` and `onMessage`. Snapshots, recording and file downloads need the `mqtt` signaling.
