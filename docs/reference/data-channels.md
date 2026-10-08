# DataChannels

The SDK uses four DataChannels, each with one job. `onDatachannel` reports each one as a `ChannelRole` when it opens.

| Role | Label | SCTP id | Ordered | Delivery | Carries |
| --- | --- | --- | --- | --- | --- |
| `ChannelRole.Command` | `command` | 0 | yes | reliable | Requests, and small answers such as `onRecording` |
| `ChannelRole.Stream` | `stream` | 1 | **no** | reliable | Everything in parts: snapshots, video lists and file transfers |
| `ChannelRole.Lossy` | `_lossy` | 2 | no | may drop | IPC, like UDP |
| `ChannelRole.Reliable` | `_reliable` | 3 | yes | reliable | IPC, like TCP |

## Which signaling has which channel

- **`mqtt`:** all four. They are set up out of band, on the fixed SCTP ids above: both sides open them locally, so `ondatachannel` never fires, and the ids must match the device's.
- **`livekit`:** only `_lossy` and `_reliable`. The SFU opens its own channels in band.
- **`cloudflare`:** none.

On the `mqtt` path, `onDatachannel` fires for all four channels even when the device runs without `--enable-ipc`. It means that the channel is ready on this side, not that anything listens on the other side.

## Why large data has its own channel

Large transfers go on `stream`, so a big `downloadVideoFile()` never blocks the commands that you send while it runs. A snapshot that you ask for in the middle of a download comes back without waiting for the file.

`stream` is unordered, and several transfers can run at once. So every request carries a `request_id`, and the device puts the same id on its answer. The SDK keeps a list of pending requests to match each answer to its request. That is how `onProgress` reports overlapping transfers separately, and how each finished answer is read as the thing that was asked for.

See also [DataChannels in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/reference/datachannels).
