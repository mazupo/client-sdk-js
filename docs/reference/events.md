# Events

Set these callbacks on a `PiCamera` before you call `connect()`.

## onConnectionState

`= (state: RTCPeerConnectionState) => {}`

Called when the state of the WebRTC connection changes.

## onDatachannel

`= (role: ChannelRole) => {}`

Called when a DataChannel opens. See [DataChannels](data-channels.md).

## onProgress

`= (received: number, total: number, type: RequestType, requestId?: string) => {}`

Called during a DataChannel transfer, with the bytes received so far and the total. `requestId` says which request the bytes belong to, so you can tell transfers apart when they overlap.

## onStream

`= (stream: MediaStream) => {}`

Called when a media stream arrives, from MQTT or from an SFU.

## onSfuStream

`= (sid: string, stream: MediaStream) => {}`

Called only when a media stream arrives from an SFU. It gives the participant's server-side id (`sid`) and the stream. On the `cloudflare` path there are no participants, so the first argument is the name of the pulled track.

On the `mqtt` path, the audio track and the first camera share one stream, so the sid is the one that arrived first. To tell cameras apart, read `track.id`: the device names them `video_track_<alias>`.

## onSnapshot

`= (base64: string) => {}`

Called after `snapshot()`, with the base64-encoded image, once every part of it has arrived.

## onVideoListLoaded

`= (res: QueryFileResponse) => {}`

Called with the details of the recorded files, after `fetchVideoList()`.

## onVideoDownloaded

`= (file: Uint8Array) => {}`

Called when a video file has downloaded, after `downloadVideoFile()`.

## onTimeout

`= () => {}`

Called when the connection is not up within `timeout`. It also calls `terminate()`.

## onError

`= (err: Error) => {}`

Called when signaling fails for a reason worth showing to a user. For example: a device that never reported a session, a device that is registered but not publishing, or a track that the SFU refused. `onTimeout` is different: it only says that the connection never came up.

## onDeviceSession

`= (session: DeviceSession) => {}`

Called on the `cloudflare` path, after the device's session record is read and before the connection is built. Cloudflare makes a new session id each time the device reconnects, so this is the only place to see the current one.

## onMessage

`= (msg: Uint8Array) => {}`

Called when an IPC message arrives from the device.

## onRecording

`= (res: RecordingResponse) => {}`

Called when the device answers `startRecording()` or `stopRecording()`.

- `res.isRecording`: `true` if recording started, `false` if it stopped.
- `res.filepath`: the path of the file being recorded.

## onRoomInfo

`= (participant: RoomInfo) => {}`

Called when the SFU room information changes.

## onQuality

`= (quality: Quality[]) => {}`

Called when the SFU connection quality changes.

## onSpeaking

`= (speaking: Speaking[]) => {}`

Called when an SFU participant starts or stops speaking.

## onParticipant

`= (participant: Participant[]) => {}`

Called when the list of participants in the SFU room changes.
