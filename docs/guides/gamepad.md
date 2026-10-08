# Gamepad

Read a gamepad in the browser, and send each reading to the device. On the device, pi-webrtc writes the gamepad state to a Unix socket as JSON lines. See [Gamepad in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/integrations/gamepad).

The device must run pi-webrtc with `--enable-gamepad`. Without it, the readings are sent but dropped.

## Plain JavaScript

`attachGamepad()` reads a controller and sends each reading on the lossy channel. You can call it before or after `connect()`. It sends nothing until the channel is open, and it stops sending when the connection ends. The reading loop keeps running, and `onSnapshot` and `onButton` keep working.

```javascript
import { PiCamera } from '@mazupo/client';
import { attachGamepad, Button } from '@mazupo/client/gamepad';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8084,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

const pad = attachGamepad(camera, { hz: 60 });

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

## React

`useGamepad` runs the reading loop while the component is mounted, and `<GamepadView>` draws the gamepad. Only `connected` and `suspended` go into React state. The readings arrive 60 times a second and go straight to the view, so a moving stick re-renders only that view.

```tsx
import { PiCamera } from '@mazupo/client';
import { GamepadView, useGamepad } from '@mazupo/client/gamepad/react';

// Pass the camera as soon as it exists, and null before that.
function Controller({ camera }: { camera: PiCamera | null }) {
  const { connected, suspended, sampler } = useGamepad({ camera, hz: 60 });

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

`react` is an optional peer dependency. You only need it for this entry point.

See [Gamepad](../reference/gamepad.md) in the API reference for every export and option.
