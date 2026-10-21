# Gamepad

Send a gamepad from the browser to the device. pi-webrtc writes it to a Unix socket as JSON lines. See [Gamepad in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/integrations/gamepad).

The device must run pi-webrtc with `--enable-gamepad`. Without it, the readings are sent but dropped.

Every connection has `gamepad()`: `MqttCamera`, `LiveKitRoom` and `CloudflareRoom`.

## Plain JavaScript

`gamepad()` sends each reading on the lossy channel. Call it before or after `connect()`. It stops on `disconnect()`.

```javascript
import { MqttCamera } from '@mazupo/client';
import { Button } from '@mazupo/client/gamepad';

const camera = new MqttCamera({
  deviceId: 'your-device-id',
  host: 'your.mqtt.cloud',
  port: 8084,
  username: 'hakunamatata',
  password: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

const pad = camera.gamepad({ hz: 60 });

// snapshot is null when no controller is reporting.
pad.onSnapshot((snapshot) => {
  console.log(snapshot?.leftX, snapshot?.leftY);
});

// Fires once on press and once on release, never while the button is held.
pad.onButton(Button.A, (pressed) => {
  if (pressed) camera.snapshot();
});

camera.connect();
```

## In a room

In a room, the gamepad goes where `sendText()` goes. In a `CloudflareRoom`, that is every device that you control. Take control first. To drive only some of them, pass `deviceIds`:

```javascript
import { CloudflareRoom } from '@mazupo/client';

const room = new CloudflareRoom({
  apiUrl: 'https://api.mazupo.com/sfu',
  apiKey: 'VIEWER_PUBLIC_KEY',
  roomId: 'your-room',
  ipc: true,
});
room.connect();

room.takeControl('rudder');
room.gamepad({ deviceIds: ['rudder'] });

// Later, drive another device as well.
room.takeControl('crane');
room.gamepad({ deviceIds: ['rudder', 'crane'] });
```

A connection has one gamepad, so each call returns the same one.

## React

`useGamepad` sends a gamepad while the component is mounted. `<GamepadView>` draws it.

```tsx
import type { Connection } from '@mazupo/client';
import { GamepadView, useGamepad } from '@mazupo/client/gamepad/react';

// Pass the connection as soon as it exists, and null before that.
function Controller({ connection }: { connection: Connection | null }) {
  const { connected, suspended, sampler } = useGamepad(connection, { hz: 60 });

  if (!connected) {
    return <p>Press any button on your gamepad</p>;
  }

  return (
    <>
      <GamepadView sampler={sampler} />
      {suspended && <p>Input paused ({suspended})</p>}
    </>
  );
}
```

In a room, `useGamepad(room, { deviceIds })` sends only to those devices.

`react` is an optional peer dependency. You only need it for this entry point.

See [Gamepad](../reference/gamepad.md) in the API reference for every export and option.
