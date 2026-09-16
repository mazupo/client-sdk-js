# API Documentation

* [Data channels](#data-channels)
* [Options](#options)
* [Events](#events)
  * [onConnectionState](#onConnectionState)
  * [onDatachannel](#onDatachannel)
  * [onProgress](#onprogress)
  * [onStream](#onstream)
  * [onSfuStream](#onsfustream)
  * [onSnapshot](#onSnapshot)
  * [onVideoListLoaded](#onVideoListLoaded)
  * [onVideoDownloaded](#onvideodownloaded)
  * [onMessage](#onmessage)
  * [onRecording](#onrecording)
  * [onTimeout](#onTimeout)
  * [onError](#onerror)
  * [onRoomInfo](#onroominfo)
  * [onQuality](#onquality)
  * [onSpeaking](#onspeaking)
  * [onParticipant](#onparticipant)
  * [onDeviceSession](#ondevicesession)
* [Methods](#methods)
  * [connect](#connect)
  * [terminate](#terminate)
  * [getStatus](#getStatus)
  * [getStats](#getStats)
  * [refresh](#refresh)
  * [fetchVideoList](#fetchVideoList)
  * [downloadVideoFile](#downloadVideoFile)
  * [setCameraControl](#setCameraControl)
  * [snapshot](#snapshot)
  * [startRecording](#startrecording)
  * [stopRecording](#stoprecording)
  * [sendText](#sendText)
  * [sendData](#sendData)
  * [canSend](#canSend)
  * [toggleMic](#toggleMic)
  * [toggleSpeaker](#toggleSpeaker)
  * [setJitterBufferTarget](#setJitterBufferTarget)
  * [getJitterBufferTarget](#getJitterBufferTarget)
* [Gamepad](#gamepad)
  * [The device has to be listening](#the-device-has-to-be-listening)
  * [Exports](#exports)
  * [Options](#options)
  * [Behaviour](#behaviour)

## Data channels

Four channels, each with one job. `onDatachannel` reports each one as a `ChannelRole`.

| Role | Label | SCTP id | Ordered | Reliability | Carries |
| --- | --- | --- | --- | --- | --- |
| `ChannelRole.Command` | `command` | 0 | yes | reliable | Requests, and small responses such as `onRecording` |
| `ChannelRole.Stream` | `stream` | 1 | **no** | reliable | Everything chunked: snapshots, video lists, file transfers |
| `ChannelRole.Lossy` | `_lossy` | 2 | no | may drop | IPC, UDP-like |
| `ChannelRole.Reliable` | `_reliable` | 3 | yes | reliable | IPC, TCP-like |

On the `mqtt` path the four are **negotiated out-of-band** on those fixed SCTP ids: both sides
open them locally, so `ondatachannel` never fires and the ids have to match the device's. Over
`livekit` the SFU opens its own reserved channels in-band instead, and only `_lossy` / `_reliable`
exist there. The `cloudflare` path has no data channels at all.

Because a negotiated channel opens as soon as the SCTP association is up, whether or not the
device opened its side, `onDatachannel` fires for all four on the `mqtt` path even when the device
is running without `--enable-ipc`. It reports that the channel is usable locally, not that anything
is listening on the other end.

Splitting bulk content onto its own channel is what keeps a multi-megabyte `downloadVideoFile()`
from blocking the commands issued while it runs — a snapshot requested mid-transfer comes back
without waiting for the file. Because `stream` is unordered and several streams are in flight at
once, every request carries a `request_id` that the device echoes on the matching answer.

Nothing on a stream says what its body is: `request_id` names the request it answers, and the
channel it arrived on says whether it is an answer at all or an IPC payload. The client keeps the
pending-request map that turns one into the other, so `onProgress` can report overlapping
transfers separately and each completed body is parsed as what was actually asked for.

## Options

Available flags for initialization.

| Option          | Type       | Default | Description                                                  |
| --------------- | ---------- | ------- | ------------------------------------------------------------ |
| signaling       | `'mqtt' \| 'livekit' \| 'cloudflare'` | `mqtt` | Which backend the device is reachable through. |
| uid             | `string`   |         | The custom `--uid` provided in the running `pi_webrtc`. Used by `mqtt` and `cloudflare`. |
| mqttHost        | `string`   |         | The MQTT server host.                                        |
| mqttPath        | `string`   | `/mqtt` | The MQTT server path.                                        |
| mqttPort        | `number`   | `8884`  | The WebSocket port for the MQTT server.                      |
| mqttProtocol    | `string`   | `wss`   | The protocol for the MQTT server.                            |
| mqttUsername    | `string`   |         | The username for the MQTT server.                            |
| mqttPassword    | `string`   |         | The password for the MQTT server.                            |
| livekitUrl      | `string`   |         | The WebSocket URL of the LiveKit relay. Matches `pi_webrtc`'s `--livekit-url`. |
| livekitKey      | `string`   |         | The key LiveKit issued, matching `pi_webrtc`'s `--livekit-key`. Not the same as `apiKey`. |
| livekitRoom     | `string`   |         | The room to join. Matches `pi_webrtc`'s `--livekit-room`.    |
| userId          | `string`   | `(random uuid)` | The user identifier displayed in the room after joining the SFU server. |
| apiUrl          | `string`   |         | Base URL of the picamera device API, which fronts both SFU backends. |
| apiKey          | `string`   |         | The device API's viewer key, sent as `Authorization: Bearer`. |
| stunUrls        | `string[]` |         | An array of STUN server URLs for WebRTC. Leave out or set to null for local network or VPN IP addresses. |
| turnUrls        | `string[]` |         | The TURN server URL for WebRTC.                              |
| turnUsername    | `string`   |         | The username for the TURN server.                            |
| turnPassword    | `string`   |         | The password for the TURN server.                            |
| timeout         | `number`   | `10000` | The connection timeout in milliseconds (`ms`).               |
| datachannelOnly | `boolean`  | `false` | Specifies that the connection is only for data transfer, without media streams. |
| isMicOn         | `boolean`  | `true`  | Enables the local microphone stream by default if the connection is established. |
| isSpeakerOn     | `boolean`  | `true`  | Enables the remote audio stream by default if the connection is established. |
| codec           | `string`   |         | Codecs include `H264`, `VP8`, `VP9`, and `AV1`. Ignored where the device is not sending that codec. |
| jitterBufferTarget | `number` |         | Milliseconds of media the receive jitter buffer should hold (`0`–`4000`). See [setJitterBufferTarget](#setJitterBufferTarget). |

## Events
- ### onConnectionState

  `= (state: RTCPeerConnectionState) => {}`

  Emitted when the WebRTC peer connection state changes.

- ### onDatachannel

  `= (role: ChannelRole) => {}`

  Emitted when the data channel successfully opens for data communication.

- ### onProgress

  `= (received: number, total: number, type: RequestType, requestId?: string) => {}`

  Emitted during DataChannel transfers with received/total progress. `requestId` says which request the bytes belong to, so overlapping transfers can be told apart.

- ### onStream

  `= (stream: MediaStream) => {}`

  Triggered when a media stream is received from either SFU or MQTT.

- ### onSfuStream

  `= (sid: string, stream: MediaStream) => {}`

  Triggered only when a media stream is received from the SFU, delivering both the participant's server-side ID (sid) and the associated MediaStream. On the `cloudflare` path there are no participants, so the first argument is the name of the track that was pulled.

  On the `mqtt` path the audio track and the first camera share one stream, so the sid is whichever arrived first. To tell cameras apart, read `track.id` — the device names them `video_track_<alias>`.

- ### onSnapshot

  `= (base64: string) => {}`

  Emitted after calling the `snapshot()` method. This event emits a base64-encoded image once all image packets are received from the server.

- ### onVideoListLoaded

  `= (res: QueryFileResponse) => {}`

  Emitted when the metadata of a recording file is retrieved.

- ### onVideoDownloaded

  `= (file: Uint8Array) => {}`

  Emitted when a video file is successfully downloaded from the server.

- ### onTimeout

  `= () => {}`

  Emitted when the P2P connection cannot be established within the allotted time. Automatically calls the `terminate()` function.

- ### onError

  `= (err: Error) => {}`

  Emitted when signaling fails for a reason worth putting in front of a user — a device that has never reported a session, one that is registered but not publishing, a track the SFU refused. Distinct from `onTimeout`, which only says the peer never came up.

- ### onDeviceSession

  `= (session: DeviceSession) => {}`

  Emitted on the `cloudflare` path once the device's session record has been read, before the peer is built. Cloudflare mints a new session id on every device reconnect, so this is the only place the current one is visible.

- ### onMessage

  `= (msg: Uint8Array) => {}`

  Emitted when an IPC message is received from the server.

- ### onRecording

  `= (res: RecordingResponse) => {}`

  Emitted when the server responds to a `startRecording()` or `stopRecording()` command.

  - `res.isRecording` — `true` if recording has started, `false` if it has stopped.
  - `res.filepath` — The active recording file path.

- ### onRoomInfo

  `= (participant: RoomInfo) => {}`

  Emitted when the SFU room information changes.

- ### onQuality

  `= (quality: Quality[]) => {}`

  Emitted when SFU connection quality changes.

- ### onSpeaking

  `= (speaking: Speaking[]) => {}`

  Emitted when an SFU participant starts or stops speaking.

- ### onParticipant

  `= (participant: Participant[]) => {}`

  Emitted when the list of participants in the SFU room changes.

## Methods

- ### connect

  `.connect()`

  Starts establishing the WebRTC connection.

- ### terminate

  `.terminate()`

  Terminates the WebRTC connection.

- ### getStatus

  `.getStatus()` 
  
  Retrieves the current connection status.

- ### getStats

  `.getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined`

  The browser's stats for the receiving peer, where `inbound-rtp` reports the jitter buffer, freezes and packet loss actually being seen. `undefined` before a peer exists.

- ### refresh

  `.refresh(): Promise<number>`

  Pulls whatever the device has started publishing since the connection was established, and resolves to how many tracks that was. Rejects if the SFU refuses. Only the `cloudflare` path has anything to re-read; elsewhere new tracks arrive on their own and this resolves to `0`.

- ### fetchVideoList

  `.fetchVideoList(options?: { param?: string | Date, mode?: VideoMode })`

  Retrieves recording file metadata.

  If called without arguments, returns metadata of the latest recorded file.

  If `param` is a file path (string), returns metadata of up to 8 older recordings before the given file.

  If `param` is a date, returns metadata of the closest recorded file to that time.

  - `param` - (optional) A file path (`string`) or a `Date`; controls pagination/filtering.
  - `mode` - (optional) Filters results to the specified `VideoMode`.

- ### downloadVideoFile

  `.downloadVideoFile(path: string)` 
  
  Requests a video file from the server.

  - `path` - The path to the video file.

- ### setCameraControl

  `.setCameraControl(key: CameraControlId, value: CameraControlValue)`
  
  Sets camera properties (for example, 3A controls).

- ### snapshot

  `.snapshot(quality?: number)`

   Requests a snapshot image from the server.

  - `quality` - The range from `0` to `100`, determines the image quality. The default value is `30`.

- ### startRecording

  `.startRecording()`

  Sends a `START_RECORDING` command to the server via the command DataChannel. The server response is delivered via `onRecording`.

- ### stopRecording

  `.stopRecording()`

  Sends a `STOP_RECORDING` command to the server via the command DataChannel. The server response is delivered via `onRecording`.

- ### sendText

  `.sendText(msg: string, mode?: 'lossy' | 'reliable')`
  
  Sends an IPC message. `mode` is chosen per message and defaults to `reliable`, which retransmits until delivered; `lossy` may drop the message but has lower latency. Both channels are open whenever the device runs with `--enable-ipc`. Payloads over 64 KB are chunked and are only accepted on `reliable`.

- ### sendData

  `.sendData(binary: Uint8Array, mode?: 'lossy' | 'reliable')`

  Same as `sendText`, but sends in binary format.

- ### canSend

  `.canSend(mode?: 'lossy' | 'reliable'): boolean`

  Whether a payload sent right now would reach the device. False until the channel carrying `mode` is open, and again once the connection is gone.

- ### toggleMic

  `.toggleMic(enabled?: boolean)`

  Toggles the **local** audio stream on or off. If an argument is provided, it will force the state to the specified value, otherwise, the current state will be toggled.

- ### toggleSpeaker

  `.toggleSpeaker(enabled?: boolean)`

  Toggles the **remote** audio stream on or off. If an argument is provided, it will force the state to the specified value, otherwise, the current state will be toggled.

- ### setJitterBufferTarget

  `.setJitterBufferTarget(target: number | null)`

  Milliseconds the receive jitter buffer should hold (`0`–`4000`, clamped). Lower means less delay but more freezes. `null` hands the decision back to the browser.

  A hint: the browser converges on it gradually, so read the real delay from [getStats](#getStats). Needs Chrome 124, Firefox 115 or Safari 27.

- ### getJitterBufferTarget

  `.getJitterBufferTarget(): number | null | undefined`

  The target last asked for, not the one the browser settled on. `undefined` means none has been asked for.

## Gamepad

Reads a controller, encodes each reading, and sends it to the device's `gamepad` endpoint.

```ts
import { attachGamepad, Button, isPressed } from '@mazupo/client/gamepad';
import { useGamepad, GamepadView } from '@mazupo/client/gamepad/react';
```

`react` is an optional peer dependency, needed only for the second. `GamepadView` draws with SVG
and is web-only; the headless entry point works under React Native.

Examples: [browser](EXAMPLES.md#drive-a-device-with-a-gamepad),
[React](EXAMPLES.md#gamepad-in-react).

### The device has to be listening

```bash
pi-webrtc --enable-ipc --enable-gamepad ...
```

`--enable-ipc` opens the channels this arrives on, `--enable-gamepad` opens the socket it is
routed to. Without the second, input is sent and silently discarded.

Each reading reaches that socket as a `protocol.InputReport`, preceded by a big-endian `uint32`
length:

```python
header = await reader.readexactly(4)
body = await reader.readexactly(int.from_bytes(header, "big"))
report = InputReport(); report.ParseFromString(body)
```

### Exports

| Export | |
| --- | --- |
| `attachGamepad(camera, options?)` | Reads a controller into a `PiCamera`. Returns the sampler, already running |
| `GamepadSampler` | The loop. `start()`, `stop()`, `onSnapshot()`, `onButton()`, `onButtonChange()`, `onSuspend()`, `setSink()`, `.snapshot`, `.sampling` |
| `toSnapshot(gamepad)` | Browser `Gamepad` to a plain snapshot |
| `isPressed(snapshot, index)` / `Button` | Reading the bitfield |
| `sameSnapshot(a, b)` | Whether two readings would drive the hardware identically |
| `InputReport`, `GamepadInput` | The generated protobuf types |
| `useGamepad(options)` <sup>react</sup> | Runs a sampler for the life of a component |
| `GamepadView` <sup>react</sup> | The SVG view |

`attachGamepad(camera, options?)` is the whole setup, in any order relative to `connect()`: a
reading taken before the link is up is dropped, and sending picks up once the channel opens.
[canSend](#canSend) is what it consults. `GamepadSampler` is the same loop without the camera,
for driving it by hand or sending somewhere else; its `setSink()` changes destination, it does
not follow a connection.

`buttons` is a bitfield, bit *n* being `buttons[n].pressed` in the standard mapping; read it with
`isPressed(snapshot, Button.Start)`. An axis or button the controller does not report reads as
centred or released rather than throwing.

`onButton` and `onButtonChange` fire once on press and once on release, never while a button is
held, and run whether or not a sink is set. Both return a function that removes the listener. A
controller unplugged mid-hold reports whatever it held as released, so a toggle cannot stick on.

### Options

Taken by `attachGamepad`, `useGamepad`, and the `GamepadSampler` constructor.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| hz | `number` | `60` | Samples per second. |
| endpoint | `string` | `gamepad` | The device IPC endpoint each reading is addressed to. |
| sampleWhileHidden | `boolean` | `false` | Keep sampling while the document is hidden. |
| sink | `IpcSink \| null` | | Destination, for `GamepadSampler` only. `attachGamepad` and `useGamepad` take the camera instead. |

Anything with `sendToEndpoint` is an `IpcSink`, exported from the main entry point; `PiCamera`
implements it.

### Behaviour

- Samples on a fixed timer rather than `requestAnimationFrame`: the device reads a steady stream
  as proof the link is alive, so the rate must not follow the display.
- Stops while the document is hidden. `sampleWhileHidden: true` overrides it.
- Sequences every message, so the device can drop a stale reading arriving late on the unordered
  lossy channel.
- Sends nothing for a pad outside the W3C standard mapping, reporting it as
  `standardMapping: false` — its fields would not mean what their names say.
- `start()` is idempotent, and a second controller does not start a second loop.
- Applies no deadzone. pi-webrtc's own consumer does, and splitting that decision across two
  codebases would drift.

---

Back to the [README](../README.md).
