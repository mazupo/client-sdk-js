# Cloudflare Realtime

Watch through Cloudflare's Realtime SFU, with nothing to host yourself. The device API keeps the Cloudflare App ID and Secret, so the browser only needs its own viewer key.

The example below uses the free test server and its viewer API key. First, start the device on the same server, as shown in [SFU: Cloudflare Realtime](https://mazupo.com/docs/pi-webrtc/signaling/sfu#cloudflare-realtime) in the pi-webrtc docs. That page also lists the limits of the test server. All users share it, so use a unique `uid`.

```javascript
import { PiCamera } from '@mazupo/client';

const videoRef = document.getElementById('videoElement');
const camera = new PiCamera({
  signaling: 'cloudflare',
  apiUrl: 'https://api.mazupo.com',
  apiKey: 'ec0478c67e729b6f429eda1e97829af0',
  uid: 'your-custom-uid',
});

// A device may publish more than one track. Each one arrives under the name it was published with.
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

// The device may publish more tracks later. Nothing pulls them in on its own.
// camera.refresh();
```

Cloudflare has no participants, so `onSfuStream` gives a **track name** instead of a `sid`.

The device gets a new session id each time it reconnects. That is why the viewer finds the device by its `uid`, not by a session.

Cloudflare carries no DataChannel, so only the video and audio work.
