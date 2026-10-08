# Methods

The methods of a `PiCamera`.

## connect

`.connect()`

Starts the WebRTC connection.

## terminate

`.terminate()`

Ends the WebRTC connection.

## getStatus

`.getStatus()`

Returns the current connection status.

## getStats

`.getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> | undefined`

The browser's stats for the receiving connection. `inbound-rtp` shows the jitter buffer, the freezes and the packet loss. Returns `undefined` before a connection exists.

## refresh

`.refresh(): Promise<number>`

Pulls in the tracks that the device started to publish after the connection was made, and resolves to how many there were. Rejects if the SFU refuses. Only the `cloudflare` path needs it. On the other paths, new tracks arrive on their own, and it resolves to `0`.

## fetchVideoList

`.fetchVideoList(options?: { param?: string | Date, mode?: VideoMode })`

Gets the details of recorded files. The answer arrives in `onVideoListLoaded`.

- With no arguments, it returns the newest recorded file.
- If `param` is a file path (a string), it returns up to 8 recordings older than that file.
- If `param` is a `Date`, it returns the recorded file closest to that time.
- `mode` (optional) selects the set of files, as a `VideoMode`.

## downloadVideoFile

`.downloadVideoFile(path: string)`

Downloads a video file from the device. The file arrives in `onVideoDownloaded`.

- `path`: the path of the video file.

## setCameraControl

`.setCameraControl(key: CameraControlId, value: CameraControlValue)`

Changes a camera control, such as brightness or white balance.

## snapshot

`.snapshot(quality?: number)`

Asks the device for a snapshot. The image arrives in `onSnapshot`.

- `quality`: the JPEG quality, from `0` to `100`. The default is `30`.

## startRecording

`.startRecording()`

Sends `start_recording` to the device over the command DataChannel. The answer arrives in `onRecording`.

## stopRecording

`.stopRecording()`

Sends `stop_recording` to the device over the command DataChannel. The answer arrives in `onRecording`.

## sendText

`.sendText(msg: string, mode?: 'lossy' | 'reliable')`

Sends an IPC message. You choose `mode` for each message, and the default is `reliable`. `reliable` sends the message again until it arrives. `lossy` may drop it, but has less delay. Both channels are open when the device runs with `--enable-ipc`. Messages larger than 64 KB are split into parts, and only work on `reliable`.

## sendData

`.sendData(binary: Uint8Array, mode?: 'lossy' | 'reliable')`

The same as `sendText`, for binary data.

## canSend

`.canSend(mode?: 'lossy' | 'reliable'): boolean`

Whether a message sent now would reach the device. It is false until the channel for `mode` is open, and false again after the connection ends.

## toggleMic

`.toggleMic(enabled?: boolean)`

Turns the **local** microphone on or off. With an argument, it sets that state. Without one, it switches the current state.

## toggleSpeaker

`.toggleSpeaker(enabled?: boolean)`

Turns the **remote** audio on or off. With an argument, it sets that state. Without one, it switches the current state.

## setJitterBufferTarget

`.setJitterBufferTarget(target: number | null)`

How many milliseconds the receive buffer should hold, from `0` to `4000`. Less means less delay, but more freezes. `null` lets the browser decide.

It is a hint: the browser moves toward it slowly, so read the real delay with [getStats](#getstats). It needs Chrome 124, Firefox 115 or Safari 27.

## getJitterBufferTarget

`.getJitterBufferTarget(): number | null | undefined`

The target that you asked for, not the one the browser reached. `undefined` means that you have not asked for one.
