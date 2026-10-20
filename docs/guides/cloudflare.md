# Cloudflare Realtime

Use `CloudflareRoom` to watch every device in a room through Cloudflare Realtime SFU. A [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker) gives out access tokens and wakes the devices. The browser only needs the viewer public key.

A device streams only while someone watches its room.

## Free test server

<!-- TODO: fill in the viewer public key when the worker is deployed. -->

| API URL | Viewer public key |
| --- | --- |
| `https://api.mazupo.com/cloudflare` | `VIEWER_PUBLIC_KEY` |

Start a device on the same server first. See [SFU: Cloudflare Realtime](https://mazupo.com/docs/pi-webrtc/signaling/sfu#cloudflare-realtime). The server is shared, so use a room name nobody else uses.

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

// Later: room.disconnect();
```

Each device has a `state`:

- `offline`: the device is not connected to the worker.
- `sleeping`: the device is connected, and nobody watches it.
- `waking`: the device is starting to stream.
- `live`: the device streams. Its `stream` comes soon after.

If a device does not play, its `error` says why. For example, `viewer_limit` means that the device already has the most viewers.

## Send messages to a device

With `ipc: true`, the room also opens each device's IPC channels, `_lossy` and `_reliable`. Messages from a device arrive in `onMessage`. The device must run with `--enable-ipc`.

Only the viewer that controls a device can send to it. Others wait in line.

```javascript
const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/cloudflare',
  apiKey: 'VIEWER_PUBLIC_KEY',
  roomId: 'your-room',
  ipc: true,
});

room.onMessage = (data, deviceId) => {
  console.log(deviceId, new TextDecoder().decode(data));
};

room.onDevices = (devices) => {
  const rudder = devices.find((device) => device.deviceId === 'rudder');
  if (rudder?.canSend) {
    room.sendTextTo('rudder', 'hello');
  }
};

room.connect();

// Take control of the device. If someone else controls it, you wait in line.
room.takeControl('rudder');

// Give up control, or your place in line.
room.releaseControl('rudder');
```

`sendText(text)` goes to every device that you control. `sendTextTo(deviceId, text)` goes to one of them.

`device.control` tells who controls the device, who takes over next, and who waits. `control.mine` is `true` when you control it.

## Talk with the other viewers

Viewers in a room can talk to each other, and the room's devices play their voices. The browser asks for the microphone when you connect, and you start muted.

```javascript
const voices = document.getElementById('voices');

room.onViewers = (viewers) => {
  for (const viewer of viewers) {
    if (viewer.me) continue;
    let audio = document.getElementById(`voice-${viewer.viewerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `voice-${viewer.viewerId}`;
      audio.autoplay = true;
      voices.append(audio);
    }
    if (audio.srcObject !== (viewer.stream ?? null)) {
      audio.srcObject = viewer.stream ?? null;
    }
  }
};

// A push-to-talk button.
talkButton.onpointerdown = () => room.toggleMic(true);
talkButton.onpointerup = () => room.toggleMic(false);
```

Each viewer has `microphone` and `muted`, so you can show who can talk and who is muted. `toggleSpeaker(false)` silences everyone. To only listen, pass `microphone: false`.

## Drive a device with a gamepad

Take control of the device, then start the gamepad. It goes to every device that you control, or only to `deviceIds`:

```javascript
room.takeControl('rudder');
room.gamepad({ deviceIds: ['rudder'] });
```

See [Gamepad](gamepad.md) for more.

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

Use one id per tab. The room keeps a secret for the id in `sessionStorage`. Another tab with the same id gets `viewer_id_in_use`.

Without `sessionStorage`, as in React Native, also pass `secret`: a random string of 16 or more characters that you keep with the id.

## What the room does for you

- It reconnects after the network drops, and it gets a new access token each time.
- It makes a new connection to the SFU when the old one fails, for example after a network change.
- After a reload, it carries on where it left off.

See [CloudflareRoom](../reference/cloudflare-room.md) for every option, event and method.
