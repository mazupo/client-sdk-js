# Migrating from 3.x to 4.0

Only the `cloudflare` signaling changed. If you use `mqtt` or `livekit`, nothing changes for you.

## What changed

In 3.x, `PiCamera` with `signaling: 'cloudflare'` pulled one device's tracks through the device API. In 4.0, a [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker) does this job, and the new `CloudflareRoom` class watches a whole room of devices.

- `PiCamera` no longer has `signaling: 'cloudflare'`. If you still pass it, the constructor throws an error.
- These are gone: the `apiUrl` and `apiKey` options of `PiCamera`, `refresh()`, `onDeviceSession`, and the `DeviceSession` and `ApiConnectionOptions` types.
- `CloudflareRoom` is new. See [CloudflareRoom](reference/cloudflare-room.md).

## The device has to move too

The device must run a pi-webrtc version that connects to a cf-sfu-worker. It joins one or more rooms with `--cloudflare-room`, and its `--api-url` is the worker's API URL. See [SFU: Cloudflare Realtime](https://mazupo.com/docs/pi-webrtc/signaling/sfu#cloudflare-realtime) in the pi-webrtc docs.

The worker has its own keys. The viewer key of the old device API does not work with it.

## Code

Before, in 3.x:

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  signaling: 'cloudflare',
  apiUrl: 'https://api.mazupo.com',
  apiKey: 'OLD_VIEWER_KEY',
  uid: 'your-custom-uid',
});
camera.onSfuStream = (trackName, stream) => {
  video.srcObject = stream;
};
camera.connect();
```

After, in 4.0:

```javascript
import { CloudflareRoom } from '@mazupo/client';

const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/cloudflare',
  apiKey: 'VIEWER_PUBLIC_KEY',
  roomId: 'your-room',
});
room.onDevices = (devices) => {
  const device = devices.find((d) => d.deviceId === 'your-custom-uid');
  if (device && video.srcObject !== (device.stream ?? null)) {
    video.srcObject = device.stream ?? null;
  }
};
room.connect();
```

To watch only one device, put it in a room of its own: start the device with a room that no other device joins.

## New in 4.0

- New tracks play without a call to `refresh()`. The room pulls them when the device starts to stream.
- With `ipc: true`, you can send messages to a device and receive its messages. Only one viewer at a time controls a device. See [Send messages to a device](guides/cloudflare.md#send-messages-to-a-device).
