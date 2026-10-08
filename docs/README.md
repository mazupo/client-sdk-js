# JavaScript Client SDK

`@mazupo/client` connects a web or React Native app to [pi-webrtc](https://github.com/mazupo/pi-webrtc). It plays the video, and it sends commands and data to the device. It comes with TypeScript types.

## Sections

- [Getting Started](getting-started/README.md): install the SDK and show the first video.
- [Guides](guides/README.md): snapshots, recording, IPC messages, gamepads, SFUs and more.
- [API Reference](reference/README.md): every option, event and method.
- [Migrating from 2.x](migrating-from-2x.md): renamed exports and the new wire protocol.

## Signaling

The `signaling` option selects how the SDK reaches the device:

| `signaling` | Connects through | What works |
| --- | --- | --- |
| `mqtt` (default) | An MQTT broker | Peer-to-peer video, audio both ways, and every DataChannel |
| `livekit` | A LiveKit SFU | Many viewers. Only the IPC channels. |
| `cloudflare` | Cloudflare Realtime, through the device API | Many viewers. No DataChannels. |

The device must run pi-webrtc 3.x. A 2.x device does not understand a 3.x client. See [Migrating from 2.x](migrating-from-2x.md).
