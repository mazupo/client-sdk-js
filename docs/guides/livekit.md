# LiveKit

Watch through a LiveKit SFU. Everyone in the room sees the same streams, so a device uploads one copy, no matter how many people watch.

The example uses the free test server. Start the device in the same room first. See [SFU: LiveKit](https://mazupo.com/docs/pi-webrtc/signaling/sfu#livekit).

```javascript
import { LiveKitRoom } from '@mazupo/client';

const room = new LiveKitRoom({
  url: 'wss://api.mazupo.com',
  apiKey: 'APIWnQTs4tmUZvA',
  roomId: 'my-first-room',
});

const tiles = document.getElementById('tiles');

// Called with the whole list after every change.
room.onDevices = (devices) => {
  for (const device of devices) {
    let video = document.getElementById(`video-${device.deviceId}`);
    if (!video) {
      video = document.createElement('video');
      video.id = `video-${device.deviceId}`;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      tiles.append(video);
    }
    if (video.srcObject !== (device.stream ?? null)) {
      video.srcObject = device.stream ?? null;
    }
  }
};

room.connect();
```

A participant whose video arrives is a device. Everyone else is a viewer, in `onViewers`.

## Messages

Over LiveKit, only the IPC channels work: there are no snapshots, recording or file downloads.

```javascript
room.onMessage = (data, deviceId) => {
  console.log(deviceId, new TextDecoder().decode(data));
};

room.sendText('to everyone in the room');
room.sendTextTo('your-device-id', 'only to this device');
```

See [LiveKitRoom](../reference/livekit-room.md) for every option and event.
