# Options

The options of `new PiCamera(options)`.

| Option          | Type       | Default | Description                                                  |
| --------------- | ---------- | ------- | ------------------------------------------------------------ |
| signaling       | `'mqtt' \| 'livekit' \| 'cloudflare'` | `mqtt` | How the SDK reaches the device. |
| uid             | `string`   |         | The `--uid` of the device. Used by `mqtt` and `cloudflare`. |
| mqttHost        | `string`   |         | The MQTT broker host.                                        |
| mqttPath        | `string`   | `/mqtt` | The MQTT broker path.                                        |
| mqttPort        | `number`   | `8884`  | The WebSocket port of the MQTT broker.                       |
| mqttProtocol    | `string`   | `wss`   | The protocol for the MQTT broker.                            |
| mqttUsername    | `string`   |         | The username for the MQTT broker.                            |
| mqttPassword    | `string`   |         | The password for the MQTT broker.                            |
| livekitUrl      | `string`   |         | The WebSocket URL of the LiveKit server. The same as the device's `--livekit-url`. |
| livekitKey      | `string`   |         | The LiveKit API key, the same as the device's `--livekit-key`. Not the same as `apiKey`. |
| livekitRoom     | `string`   |         | The room to join. The same as the device's `--livekit-room`. |
| userId          | `string`   | random UUID | The name of this viewer in the SFU room. |
| apiUrl          | `string`   |         | The base URL of the device API, used by both SFU paths. |
| apiKey          | `string`   |         | The viewer key for the device API, sent as `Authorization: Bearer`. |
| stunUrls        | `string[]` |         | STUN server URLs. Leave it out, or set `null`, on a local network or a VPN. |
| turnUrls        | `string[]` |         | TURN server URLs.                                            |
| turnUsername    | `string`   |         | The username for the TURN server.                            |
| turnPassword    | `string`   |         | The password for the TURN server.                            |
| timeout         | `number`   | `10000` | The connection timeout, in milliseconds.                     |
| datachannelOnly | `boolean`  | `false` | Connect for data only, without video or audio.               |
| isMicOn         | `boolean`  | `true`  | Turn on the local microphone when the connection is up.      |
| isSpeakerOn     | `boolean`  | `true`  | Play the remote audio when the connection is up.             |
| codec           | `string`   |         | `H264`, `VP8`, `VP9` or `AV1`. Only used with `mqtt`. With `livekit` and `cloudflare`, the SFU forwards the codec that the device published. |
| jitterBufferTarget | `number` |         | How many milliseconds of media the receive buffer should hold (`0` to `4000`). See [setJitterBufferTarget](methods.md#setjitterbuffertarget). |
