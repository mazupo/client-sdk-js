# MqttCamera

`MqttCamera` connects to one device, peer to peer, through an MQTT broker. It is the only connection with snapshots, recording, files and camera controls.

It is a [connection](connection.md): `connect()`, `disconnect()`, `onStatus`, `onStream`, `onMessage`, `sendText()`, `gamepad()` and the rest work as described there.

```javascript
import { MqttCamera } from '@mazupo/client';

const camera = new MqttCamera({
  deviceId: 'your-device-id',
  host: 'your.mqtt.cloud',
  port: 8084,
  username: 'hakunamatata',
  password: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
});
camera.onStream = (stream) => { video.srcObject = stream; };
camera.connect();
```

## Options

Next to the [options of every connection](connection.md#options).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| deviceId | `string` | | **Required.** The device's `--uid`. |
| host | `string` | | **Required.** The MQTT broker host. |
| port | `number` | | The broker's WebSocket port, such as `8084` on EMQX Serverless. |
| path | `string` | `/mqtt` | The broker's WebSocket path. |
| protocol | `string` | `wss` | The protocol for the broker. |
| username | `string` | | The broker username. |
| password | `string` | | The broker password. |
| stunUrls | `string[]` | | STUN server URLs. Leave it out on a local network or a VPN. |
| turnUrls | `string[]` | | TURN server URLs. |
| turnUsername | `string` | | The TURN username. |
| turnPassword | `string` | | The TURN password. |
| datachannelOnly | `boolean` | `false` | Connect for data only, without video or audio. |
| codec | `string` | | The video codec to ask the device for: `H264`, `VP8`, `VP9` or `AV1`. |
| maxBitrate | `number` | | The most video bitrate the device may send to you, in kbps. See [Bandwidth](../guides/bandwidth.md). |

Your microphone goes to the device, and the device's audio comes to you, unless `datachannelOnly` is set.

## Events

Next to the [events of every connection](connection.md#events).

### onDatachannel

`= (role: ChannelRole) => {}`

Called when a DataChannel opens. See [DataChannels](data-channels.md).

### onSnapshot

`= (base64: string) => {}`

Called after `snapshot()`, with the image as a data URL, once every part of it has arrived.

### onRecording

`= (res: RecordingResponse) => {}`

Called when the device answers `startRecording()` or `stopRecording()`.

- `res.isRecording`: `true` if recording started, `false` if it stopped.
- `res.filepath`: the path of the file being recorded.

### onVideoListLoaded

`= (res: QueryFileResponse) => {}`

Called with the details of the recorded files, after `fetchVideoList()`.

### onVideoDownloaded

`= (file: Uint8Array) => {}`

Called when a file has downloaded, after `downloadVideoFile()`.

### onProgress

`= (received: number, total: number, type: RequestType, requestId?: string) => {}`

Called during a transfer, with the bytes received so far and the total. `requestId` tells transfers apart when they overlap.

## Methods

Next to the [methods of every connection](connection.md#methods).

### deviceId

`.deviceId: string`

The device's `--uid`.

### snapshot

`.snapshot(quality?: number)`

Asks the device for a still image. The image arrives in `onSnapshot`.

- `quality`: the JPEG quality, from `0` to `100`. The default is `30`.

### startRecording

`.startRecording()`

Starts the device's recorder. The answer arrives in `onRecording`.

### stopRecording

`.stopRecording()`

Stops the device's recorder. The answer arrives in `onRecording`.

### fetchVideoList

`.fetchVideoList(options?: { param?: string | Date, mode?: VideoMode })`

Gets the details of recorded files. The answer arrives in `onVideoListLoaded`. Set `onVideoListLoaded` first: without it, nothing is asked.

- With no arguments, it returns the newest recorded file.
- If `param` is a file path (a string), it returns up to 8 recordings older than that file.
- If `param` is a `Date`, it returns the recorded file closest to that time.
- `mode` (optional) selects the set of files, as a `VideoMode`.

### downloadVideoFile

`.downloadVideoFile(path: string)`

Downloads a file from the device. The file arrives in `onVideoDownloaded`. Set `onVideoDownloaded` first: without it, nothing is asked.

### setCameraControl

`.setCameraControl(key: CameraControlId, value: CameraControlValue)`

Changes a camera control, such as brightness or white balance. See [Camera controls](../guides/camera-controls.md).
