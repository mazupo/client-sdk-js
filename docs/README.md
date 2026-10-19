# JavaScript Client SDK

`@mazupo/client` connects a web or React Native app to [pi-webrtc](https://github.com/mazupo/pi-webrtc). It plays the video, and it sends commands and data to the device. It comes with TypeScript types.

## Sections

- [Getting Started](getting-started/README.md): install the SDK and show the first video.
- [Guides](guides/README.md): snapshots, recording, IPC messages, gamepads, SFUs and more.
- [API Reference](reference/README.md): every class, option, event and method.
- [Migrating from 3.x](migrating-from-3x.md): `PiCamera` became `MqttCamera` and `LiveKitRoom`, and Cloudflare moved to `CloudflareRoom`.
- [Migrating from 2.x](migrating-from-2x.md): renamed exports and the new wire protocol.

## Three ways to connect

Use the class that matches how the device connects. All three are [connections](reference/connection.md): they share the same status, IPC, gamepad, microphone and speaker API.

| Class | Connects through | What works |
| --- | --- | --- |
| [`MqttCamera`](reference/mqtt-camera.md) | An MQTT broker, then peer to peer | One device. Video, audio both ways, IPC, snapshots, recording, files and camera controls. |
| [`LiveKitRoom`](reference/livekit-room.md) | A LiveKit SFU | A room of devices for many viewers. IPC to the room or to one device. |
| [`CloudflareRoom`](reference/cloudflare-room.md) | Cloudflare's SFU, through a cf-sfu-worker | A room of devices that stream only while someone watches. One viewer at a time controls each device. See [Cloudflare Realtime](guides/cloudflare.md). |

The device must run pi-webrtc 3.x or later. A 2.x device does not understand a 3.x or 4.x client. See [Migrating from 2.x](migrating-from-2x.md).
