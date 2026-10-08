# Getting Started

Install the SDK and show live video from a pi-webrtc device.

- [Web](web.md): a complete HTML page.
- [React Native](react-native.md): an app with `react-native-webrtc`.

## Before you start

The device must run pi-webrtc with MQTT. See [MQTT in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/signaling/mqtt). You need:

- The `--uid` that the device was started with.
- The MQTT broker host, and its **WebSocket** port. On HiveMQ Cloud, this is `8884`.
- The broker username and password.
