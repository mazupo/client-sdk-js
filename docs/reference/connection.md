# Connection

`MqttCamera`, `LiveKitRoom` and `CloudflareRoom` are all connections. Everything on this page works the same on all three. Each class adds its own options, events and methods:

- [MqttCamera](mqtt-camera.md): one device, peer to peer, through an MQTT broker.
- [LiveKitRoom](livekit-room.md): a room on a LiveKit SFU.
- [CloudflareRoom](cloudflare-room.md): a room on Cloudflare's SFU, through a cf-sfu-worker.

The two rooms also share the [room](#rooms) part below.

```javascript
camera.onStatus = (status) => console.log(status);
camera.onStream = (stream) => { video.srcObject = stream; };
camera.connect();

// Later:
camera.sendText('hello');
camera.disconnect();
```

## Options

Every connection takes these, next to its own options.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| timeout | `number` | `10000`, or `0` for `CloudflareRoom` | How long `connect()` waits to be `connected`, in milliseconds. Then it gives up with the error `timeout`. `0` waits forever. |
| isMicOn | `boolean` | `true`, or `false` for `CloudflareRoom` | Whether your microphone starts unmuted, where the connection sends one. |
| isSpeakerOn | `boolean` | `true` | Whether the audio that you receive plays. |
| jitterBufferTarget | `number` | | How many milliseconds of media the receive buffer should hold (`0` to `4000`). See [setJitterBufferTarget](#setjitterbuffertarget). |

## Events

### onStatus

`= (status: ConnectionStatus) => {}`

| Status | Meaning |
| --- | --- |
| `connecting` | After `connect()`, until the connection is up. |
| `connected` | `MqttCamera` and `LiveKitRoom`: the WebRTC connection is up. `CloudflareRoom`: you are in the room. |
| `reconnecting` | The connection dropped. It tries again by itself. |
| `closed` | Before `connect()`, after `disconnect()`, or after it gave up. `onError` says why it gave up. |

### onError

`= (error: ConnectionError) => {}`

`error` is `{ code, message, deviceId? }`. `code` is in lower case:

| Code | Meaning |
| --- | --- |
| `timeout` | Not `connected` within `timeout`. The connection closes. |
| `reconnect_failed` | The connection dropped and did not come back. The connection closes. |
| `signaling` | `MqttCamera`: the broker refused something, such as the topic subscription. |
| `left` | `LiveKitRoom`: LiveKit ended the session. The connection closes. |
| `token`, `replaced`, and the worker's codes | `CloudflareRoom`. See [onError there](cloudflare-room.md#onerror). |

### onStream

`= (stream: MediaStream, id: string) => {}`

Called when a device's video and audio arrive, and when they change. In a room, `id` is the device's id. Over MQTT, `id` is the stream's id: a device can send more than one camera.

### onMessage

`= (data: Uint8Array, deviceId: string) => {}`

Called when an IPC message arrives from a device. See [IPC messages](../guides/ipc-messages.md).

## Methods

### connect

`.connect()`

Starts to connect. A closed connection can connect again.

### disconnect

`.disconnect()`

Closes the connection. In a room, a device stops streaming when nobody else watches it. The gamepad stops sending; call [gamepad](#gamepad) to start it again.

### status

`.status: ConnectionStatus`

The current status, the same as the last `onStatus`.

### sendText

`.sendText(text: string, mode?: 'reliable' | 'lossy'): boolean`

Sends text to the device's IPC socket. In a room, it goes to every device you can send to. Returns `false` if it went nowhere.

`mode` is `reliable` by default. `reliable` sends the message again until it arrives. `lossy` may drop it, but has less delay. A message larger than 64 KB is split into parts, and works only on `reliable`.

### sendData

`.sendData(data: Uint8Array, mode?: 'reliable' | 'lossy'): boolean`

The same as `sendText`, for bytes.

### canSend

`.canSend(mode?: 'reliable' | 'lossy'): boolean`

Whether `sendText()` would reach a device right now.

### gamepad

`.gamepad(options?: GamepadOptions): GamepadSampler`

Sends a gamepad to the device, 60 times a second by default. Call it before or after `connect()`. See [Gamepad](gamepad.md).

### toggleMic

`.toggleMic(enabled?: boolean)`

Mutes or unmutes your microphone. With an argument, it sets that state. Without one, it switches it. `isMicOn` tells the current state.

### toggleSpeaker

`.toggleSpeaker(enabled?: boolean)`

Plays or silences all the audio that you receive. With an argument, it sets that state. Without one, it switches it. `isSpeakerOn` tells the current state.

### getStats

`.getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined`

The browser's stats for the receiving connection. `inbound-rtp` shows the jitter buffer, the freezes and the packet loss. Returns `undefined` before a connection exists.

### setJitterBufferTarget

`.setJitterBufferTarget(target: number | null)`

How many milliseconds the receive buffer should hold, from `0` to `4000`. Less means less delay, but more freezes. `null` lets the browser decide.

It is a hint: the browser moves toward it slowly, so read the real delay with [getStats](#getstats). It needs Chrome 124, Firefox 115 or Safari 27.

### getJitterBufferTarget

`.getJitterBufferTarget(): number | null | undefined`

The target that you asked for, not the one the browser reached. `undefined` means that you have not asked for one.

## Rooms

`LiveKitRoom` and `CloudflareRoom` are rooms (`SfuRoom`). Devices and viewers share a room. A room has these too.

### Room options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| roomId | `string` | | **Required.** The room to join. |
| viewerId | `string` | random UUID | Who you are in the room. |

### onDevices

`= (devices) => {}`

Called with the whole list of devices after every change. Each device has at least `deviceId` and `stream`. Each room adds more: see [LiveKitDevice](livekit-room.md#livekitdevice) and [RoomDevice](cloudflare-room.md#roomdevice).

### onViewers

`= (viewers) => {}`

Called with everyone in the room, you included, after every change. Each viewer has at least `viewerId` and `me`.

### devices, viewers

`.devices`, `.viewers`

The current lists, the same as the last `onDevices` and `onViewers`.

### roomId, viewerId

`.roomId: string`, `.viewerId: string`

The room, and who you are in it.

### sendTextTo

`.sendTextTo(deviceId: string, text: string, mode?: 'reliable' | 'lossy'): boolean`

Sends text to one device. Returns `false` if it cannot reach the device now.

### sendDataTo

`.sendDataTo(deviceId: string, data: Uint8Array, mode?: 'reliable' | 'lossy'): boolean`

The same as `sendTextTo`, for bytes.

### canSendTo

`.canSendTo(deviceId: string, mode?: 'reliable' | 'lossy'): boolean`

Whether a message to this device would reach it right now.

### gamepad (in a room)

`.gamepad(options?: RoomGamepadOptions): GamepadSampler`

The same as [gamepad](#gamepad), with one more option: `deviceIds` sends only to those devices. Call `gamepad({ deviceIds })` again to change them. Without `deviceIds`, the gamepad goes where `sendText()` goes.
