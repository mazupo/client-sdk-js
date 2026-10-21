# API Reference

Everything that `@mazupo/client` exports. Pick the class for the way your device connects. All three are [connections](connection.md), so most of their API is the same.

| Class | Connects through | Use it for |
| --- | --- | --- |
| [MqttCamera](mqtt-camera.md) | An MQTT broker, then peer to peer | One device: video, audio both ways, IPC, snapshots, recording, files, camera controls. |
| [LiveKitRoom](livekit-room.md) | A LiveKit SFU | A room of devices that many people watch. IPC to the room or to one device. |
| [CloudflareRoom](cloudflare-room.md) | Cloudflare's SFU, through a cf-sfu-worker | A room of devices that stream only while someone watches. One viewer at a time controls each device. |

```javascript
import { MqttCamera } from '@mazupo/client';

const camera = new MqttCamera({ deviceId: 'your-device-id', host: 'your.mqtt.cloud' /* ... */ });
camera.onStream = (stream) => { /* ... */ };
camera.connect();
```

- [Connection](connection.md): the options, events and methods that every class has, and what the two rooms add.
- [MqttCamera](mqtt-camera.md), [LiveKitRoom](livekit-room.md), [CloudflareRoom](cloudflare-room.md): what each class adds.
- [DataChannels](data-channels.md): the four channels, and what each one carries.
- [Gamepad](gamepad.md): `gamepad()`, and the `@mazupo/client/gamepad` entry points.
