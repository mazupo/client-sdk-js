# CloudflareRoom

`CloudflareRoom` watches one room of a [cf-sfu-worker](https://github.com/mazupo/cf-sfu-worker): every device in the room, over one WebSocket and one WebRTC connection. See the [Cloudflare Realtime guide](../guides/cloudflare.md) for examples.

```javascript
import { CloudflareRoom } from '@mazupo/client';

const room = new CloudflareRoom({ apiUrl, apiKey, roomId });
room.onDevices = (devices) => { /* ... */ };
room.connect();
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| apiUrl | `string` | | **Required.** The worker's API URL, such as `https://api.mazupo.com/cloudflare`. The room gets its access token from `POST <apiUrl>/token`. |
| apiKey | `string` | | **Required.** The worker's viewer public key. |
| roomId | `string` | | **Required.** The room to watch. Devices join rooms with `--cloudflare-room`. |
| viewerId | `string` | random UUID | Who you are in the room, such as `Richard Tai`: 1 to 64 letters (any language), digits, spaces, `.`, `_` or `-`, with no space at either end. Others see it in the room and as the controller of a device. Connect again with the same id within 30 seconds to keep your streams and your control. |
| ipc | `boolean` | `false` | Open each device's `_lossy` and `_reliable` channels, to get its messages and to control it. |
| jitterBufferTarget | `number` | | How many milliseconds of media the receive buffer should hold (`0` to `4000`). See [setJitterBufferTarget](methods.md#setjitterbuffertarget). |

## Events

### onDevices

`= (devices: RoomDevice[]) => {}`

Called with the whole list of devices after every change: a device joins or leaves, changes state, gets a stream, or changes who controls it.

### onViewers

`= (viewers: RoomViewerInfo[]) => {}`

Called with everyone in the room, you included, after every change: a viewer joins, leaves, or loses its connection for a moment. See [RoomViewerInfo](#roomviewerinfo).

### onMessage

`= (deviceId: string, data: Uint8Array) => {}`

Called when an IPC message arrives from a device. Needs `ipc: true`.

### onStatus

`= (status: RoomStatus) => {}`

| Status | Meaning |
| --- | --- |
| `connecting` | Getting a token and joining. |
| `joined` | In the room. |
| `reconnecting` | The connection dropped. The room tries again. |
| `closed` | After `leave()`, or after another tab joined with the same `viewerId`. |

### onError

`= (error: RoomError) => {}`

Called with `{ code, message, deviceId? }`. The codes are the worker's error codes in lower case, such as `not_controller`, plus these two:

- `token`: the token request failed, for example because of a wrong `apiKey`. The room tries again.
- `replaced`: another connection joined with the same `viewerId`. The room stops and does not reconnect.

## Methods

### connect

`.connect()`

Joins the room. If the connection drops, the room reconnects by itself until you call `leave()`.

### leave

`.leave()`

Leaves the room and closes the connection. When nobody else watches a device, it stops streaming.

### takeControl

`.takeControl(deviceId: string)`

Takes control of the device if nobody controls it. If someone does, you wait in line. Needs `ipc: true`. If your channels to the device are not open yet, the room sends the request when they open.

### releaseControl

`.releaseControl(deviceId: string)`

Gives up control of the device, or your place in line. The next viewer in line takes over.

### sendText

`.sendText(deviceId: string, text: string, mode?: 'reliable' | 'lossy'): boolean`

Sends text to the device's IPC socket. Returns `false` if you do not control the device or its channel is not open. `mode` is `'reliable'` by default.

### sendData

`.sendData(deviceId: string, data: Uint8Array, mode?: 'reliable' | 'lossy'): boolean`

The same as `sendText`, for bytes. Data over 64 KiB must use `'reliable'`.

### canSend

`.canSend(deviceId: string, mode?: 'reliable' | 'lossy'): boolean`

Whether a message sent now would reach the device.

### ipcSink

`.ipcSink(deviceId: string): IpcSink`

One device as an `IpcSink`, for `attachGamepad()`. See [Gamepad](gamepad.md).

### getStats

`.getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined`

The browser's stats for the room's connection. Returns `undefined` before the connection exists.

### setJitterBufferTarget

`.setJitterBufferTarget(target: number | null)`

The same as [PiCamera's](methods.md#setjitterbuffertarget), for every track in the room.

### devices

`.devices: RoomDevice[]`

The current list of devices, the same as the last `onDevices`.

### viewers

`.viewers: RoomViewerInfo[]`

The current list of viewers, the same as the last `onViewers`.

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

To see what a viewer controls, look at `control` of each device.

A `RoomViewer` is `{ room, viewerId }`. A viewer in another room can control the same device, because a device can join up to 4 rooms.
