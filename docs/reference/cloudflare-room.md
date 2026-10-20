# CloudflareRoom

`CloudflareRoom` watches every device in one room of a [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker). See the [Cloudflare Realtime guide](../guides/cloudflare.md) for examples.

It is a [connection](connection.md) and a [room](connection.md#rooms).

```javascript
import { CloudflareRoom } from '@mazupo/client';

const room = new CloudflareRoom({ apiUrl, apiKey, roomId });
room.onDevices = (devices) => { /* ... */ };
room.connect();
```

## Options

Next to the [options of every connection](connection.md#options) and of [every room](connection.md#room-options).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| apiUrl | `string` | | **Required.** The worker's API URL, such as `https://api.mazupo.com/cloudflare`. The room gets its access token from `POST <apiUrl>/token`. |
| apiKey | `string` | | **Required.** The worker's viewer public key. |
| roomId | `string` | | **Required.** The room to watch. Devices join rooms with `--cloudflare-room`. |
| viewerId | `string` | random UUID | Your name in the room, such as `Richard Tai`: 1 to 64 letters (any language), digits, spaces, `.`, `_` or `-`. Reconnect with it within 30 seconds to keep your streams and control. |
| ipc | `boolean` | `false` | Open each device's `_lossy` and `_reliable` channels, to get its messages and to control it. |
| secret | `string` | random | 16 or more random characters, kept with `viewerId`. Only it can resume this viewer. By default the room keeps it in `sessionStorage`. Give it yourself in React Native. |
| timeout | `number` | `0` | The room keeps trying until you call `disconnect()`, unless the worker refuses its token request. |

## Status

`connected` means that you are in the room. The devices' video comes after that, as each device wakes. If the connection drops, the room is `reconnecting` until it is back. It gets a new access token each time.

## Messages and control

Only the viewer that controls a device can send to it. Others wait in line.

- `sendText()` goes to every device that you control.
- `sendTextTo(deviceId)` goes to that device, if you control it.
- `canSend()` and `canSendTo(deviceId)` tell whether a message would get there now.
- `gamepad()` goes to every device that you control, or only to `deviceIds`.

`onMessage(data, deviceId)` gets the messages of every device in the room. All of this needs `ipc: true`.

### takeControl

`.takeControl(deviceId: string)`

Takes control of the device, or waits in line. Needs `ipc: true`.

### releaseControl

`.releaseControl(deviceId: string)`

Gives up control or your place in line.

## Voice

With `microphone` (the default), the room publishes your microphone and pulls every other viewer's. You start muted.

- `toggleMic()` mutes or unmutes you. The others see it: `muted` in their `viewers`.
- Each other viewer's voice is the `stream` of its `RoomViewerInfo`. Play it in an `<audio>` element.
- `toggleSpeaker(false)` silences everyone, devices included.
- The room's devices play your voice too, unless they run with `--no-audio`.
- A room takes 10 microphones by default. Past that, `onError` gets `microphone_limit`, and you only listen.

## onError

Next to the [codes of every connection](connection.md#onerror), the codes are the worker's error codes in lower case, such as `not_controller`, plus these:

- `token`: the token request failed. A refused request, such as a wrong `apiKey`, closes the room. Otherwise the room tries again.
- `replaced`: a copy of this tab took over. The room closes.
- `viewer_id_in_use`: someone else in the room uses this `viewerId`. The room closes.
- `microphone`: the browser did not give the microphone. You only listen.
- `microphone_limit`: the room already has the most microphones. You only listen.

## RoomDevice

| Field | Type | Description |
| --- | --- | --- |
| deviceId | `string` | The device's `--uid`. |
| state | `string` | `offline`, `sleeping`, `waking` or `live`. |
| generation | `number` | Counts the device's streams. It changes when the device starts to stream again or restarts. |
| tracks | `string[]` | The names of the device's tracks. Set only while `live`. |
| stream | `MediaStream` | The device's video and audio. Set soon after the device is `live`. A new stream comes only when the tracks change. |
| error | `string` | Why the device does not play, such as `wake_timeout` or `viewer_limit`. |
| ipc | `boolean` | The device streams with `_lossy` and `_reliable`. |
| control | `RoomControl` | Who controls the device. See below. |
| canSend | `boolean` | You control the device and its `_reliable` channel is open. |

Each `state`:

- `offline`: the device is not connected to the worker.
- `sleeping`: the device is connected, and nobody watches it.
- `waking`: the device is starting to stream.
- `live`: the device streams. Its `stream` comes soon after.

`RoomControl`:

| Field | Type | Description |
| --- | --- | --- |
| controller | `RoomViewer` | The viewer who controls the device. Not set when nobody does. |
| handover | `RoomViewer` | The viewer who is taking over. |
| waiting | `RoomViewer[]` | The viewers in line, in order. |
| mine | `boolean` | You control the device. |
| takingOver | `boolean` | You are taking over. |
| inLine | `boolean` | You wait in line. |

## RoomViewerInfo

| Field | Type | Description |
| --- | --- | --- |
| viewerId | `string` | The viewer's `viewerId`. It may have spaces and letters in any language. |
| ipc | `boolean` | The viewer joined with `ipc: true`, so it can control devices. |
| away | `boolean` | The viewer's connection dropped. It can come back within 30 seconds. |
| me | `boolean` | This is you. |
| microphone | `boolean` | The viewer publishes its microphone. |
| muted | `boolean` | Its microphone is muted. |
| stream | `MediaStream` | Its voice, once it arrives. Never set for you. |

To see what a viewer controls, look at `control` of each device.

A `RoomViewer` is `{ room, viewerId }`. A viewer in another room can control the same device, because a device can join up to 4 rooms.
