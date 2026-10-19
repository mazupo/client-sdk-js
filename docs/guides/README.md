# Guides

Short, complete examples for each task. Most examples use an `MqttCamera`: `deviceId` must match the `--uid` of the device, and the MQTT settings are for the broker that the device uses. The last two guides use a room.

- [Latency](latency.md): trade buffering for a lower delay.
- [Bandwidth](bandwidth.md): cap the bitrate that the device sends to this viewer.
- [Snapshots](snapshots.md): take a still image, without a video stream.
- [Recording](recording.md): start and stop the device's recorder, and download a file.
- [Camera controls](camera-controls.md): change brightness, contrast and other image controls.
- [IPC messages](ipc-messages.md): send data to a program on the device, and receive its answers.
- [Gamepad](gamepad.md): drive a device with a gamepad, in plain JavaScript or React.
- [LiveKit](livekit.md): watch a room through a LiveKit SFU.
- [Cloudflare Realtime](cloudflare.md): watch a room of devices through Cloudflare's SFU, and control one of them.
