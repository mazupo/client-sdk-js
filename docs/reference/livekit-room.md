# LiveKitRoom

`LiveKitRoom` joins a room on a LiveKit SFU, through a relay. Devices publish into the room, and everyone in the room sees the same streams, so a device uploads one copy however many people watch.

It is a [connection](connection.md) and a [room](connection.md#rooms). See the [LiveKit guide](../guides/livekit.md) for an example.

```javascript
import { LiveKitRoom } from '@mazupo/client';

const room = new LiveKitRoom({ url, apiKey, roomId });
room.onDevices = (devices) => { /* ... */ };
room.connect();
```

## Options

Next to the [options of every connection](connection.md#options) and of [every room](connection.md#room-options).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| url | `string` | | **Required.** The relay's WebSocket URL. The same as the device's `--livekit-url`. |
| apiKey | `string` | | **Required.** The LiveKit API key. The same as the device's `--livekit-key`. |
| roomId | `string` | | **Required.** The room. The same as the device's `--livekit-room`. |
| viewerId | `string` | random UUID | Your identity in the room. |

## Devices and viewers

A participant whose video arrives is a device. Everyone else is a viewer. A device that has joined but does not stream yet shows as a viewer until its video arrives.

### LiveKitDevice

| Field | Type | Description |
| --- | --- | --- |
| deviceId | `string` | Its LiveKit identity: the device's `--uid`. |
| sid | `string` | Its LiveKit participant sid. |
| state | `string` | `JOINING`, `JOINED`, `ACTIVE` or `DISCONNECTED`. |
| stream | `MediaStream` | Its video and audio. |

### LiveKitViewer

| Field | Type | Description |
| --- | --- | --- |
| viewerId | `string` | Its LiveKit identity. |
| sid | `string` | Its participant sid. Not set for you. |
| state | `string` | As above. Not set for you. |
| me | `boolean` | This is you. |
| stream | `MediaStream` | Its voice, once it arrives. Never set for you. |

## Voice

With `microphone` (the default), you publish your microphone into the room, muted until `toggleMic()`. LiveKit sends you everyone else's. A viewer's voice is the `stream` of its `LiveKitViewer`.

Two limits, because of the relay:

- The others do not see when you mute.
- A device plays the viewers' voices only when it runs with `--enable-ipc`. Then it also gets the other devices' video and audio.

## Messages

`sendText()` goes to everyone in the room, `sendTextTo(deviceId)` to one device. Over LiveKit there are no snapshots, recording or file downloads.

## Events

Next to the [events of every connection](connection.md#events) and of [every room](connection.md#rooms).

### onRoomInfo

`= (room: RoomInfo) => {}`

The room's LiveKit sid and name.

### onQuality

`= (quality: Quality[]) => {}`

The connection quality of the participants.

### onSpeaking

`= (speaking: Speaking[]) => {}`

Who is speaking, and how loud.
