# API Reference

Everything that `@mazupo/client` exports. The main class is `PiCamera`: create it with [options](options.md), set the [events](events.md) that you need, and call its [methods](methods.md).

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({ uid: 'your-custom-uid', mqttHost: 'your.mqtt.cloud' /* ... */ });
camera.onStream = (stream) => { /* ... */ };
camera.connect();
```

- [Options](options.md): every option of `PiCamera`.
- [Events](events.md): the callbacks that `PiCamera` calls.
- [Methods](methods.md): what you can ask `PiCamera` to do.
- [DataChannels](data-channels.md): the four channels, and what each one carries.
- [Gamepad](gamepad.md): the `@mazupo/client/gamepad` entry points.
