# Cloudflare Realtime

Watch every device in a room through Cloudflare's Realtime SFU. A [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker) sits in between: it gives out access tokens, wakes the devices, and talks to the SFU. The Cloudflare app secret stays in the worker, so the browser only needs a viewer key.

A device publishes only while someone watches its room. When the first viewer joins, the device wakes and starts to stream. When the last viewer leaves, it stops.

Use `CloudflareRoom` for this, not `PiCamera`. One `CloudflareRoom` shows every device in one room, over one connection.

## Free test server

<!-- TODO: fill in the viewer public key when the worker is deployed. -->

| API URL | Viewer public key |
| --- | --- |
| `https://api.mazupo.com/cloudflare` | `VIEWER_PUBLIC_KEY` |

First, start a device on the same server, as shown in [SFU: Cloudflare Realtime](https://mazupo.com/docs/pi-webrtc/signaling/sfu#cloudflare-realtime) in the pi-webrtc docs. That page also lists the limits of the test server. All users share it, so use a room name that nobody else uses.

## Watch a room

```javascript
import { CloudflareRoom } from '@mazupo/client';

const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/cloudflare',
  apiKey: 'VIEWER_PUBLIC_KEY',
  roomId: 'your-room',
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
    // A new stream comes only when the device's tracks change.
    if (video.srcObject !== (device.stream ?? null)) {
      video.srcObject = device.stream ?? null;
    }
    video.title = `${device.deviceId}: ${device.state}`;
  }
};

room.onError = (error) => {
  console.error(error.code, error.message);
};

room.connect();

// Later: room.leave();
```

Each device has a `state`:

- `offline`: the device is not connected to the worker.
- `sleeping`: the device is connected, and nobody watches it.
- `waking`: the device is starting to stream.
- `live`: the device streams. Its `stream` comes soon after.

If a device does not play, its `error` says why. For example, `viewer_limit` means that the device already has the most viewers.

## Send messages to a device

With `ipc: true`, the room also opens each device's IPC channels, `_lossy` and `_reliable`. Messages from a device arrive in `onMessage`. The device must run with `--enable-ipc`.

Only one viewer controls a device at a time. Only that viewer's messages reach the device. Everyone else waits in line.

```javascript
const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/cloudflare',
  apiKey: 'VIEWER_PUBLIC_KEY',
  roomId: 'your-room',
  ipc: true,
});

room.onMessage = (deviceId, data) => {
  console.log(deviceId, new TextDecoder().decode(data));
};

room.onDevices = (devices) => {
  const rudder = devices.find((device) => device.deviceId === 'rudder');
  if (rudder?.canSend) {
    room.sendText('rudder', 'hello');
  }
};

room.connect();

// Take control of the device. If someone else controls it, you wait in line.
room.takeControl('rudder');

// Give up control, or your place in line.
room.releaseControl('rudder');
```

`device.control` tells who controls the device, who takes over next, and who waits. `control.mine` is `true` when you control it.

## Drive a device with a gamepad

`room.ipcSink(deviceId)` works in place of a `PiCamera` for `attachGamepad`. Take control of the device first.

```javascript
import { attachGamepad } from '@mazupo/client/gamepad';

room.takeControl('rudder');
const pad = attachGamepad(room.ipcSink('rudder'), { hz: 60 });
```

## Keep the viewer after a reload

Each `CloudflareRoom` has a random `viewerId`. To keep the same viewer after a page reload, save the id and pass it again. If you connect again within 30 seconds, the room keeps your streams and your control.

```javascript
let viewerId = sessionStorage.getItem('viewerId');
if (!viewerId) {
  viewerId = crypto.randomUUID();
  sessionStorage.setItem('viewerId', viewerId);
}

const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/cloudflare',
  apiKey: 'VIEWER_PUBLIC_KEY',
  roomId: 'your-room',
  viewerId,
});
```

Use one id per tab. When a second tab joins with the same id, the first tab stops: its `onError` gets the code `replaced`.

## What the room does for you

- It reconnects after the network drops, and it gets a new access token each time.
- It makes a new connection to the SFU when the old one fails, for example after a network change.
- When the page closes or reloads, the worker keeps your place for 30 seconds, so a reload carries on where it left off.

See [CloudflareRoom](../reference/cloudflare-room.md) for every option, event and method.
