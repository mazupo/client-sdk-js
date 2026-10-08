# Gamepad

Reads a controller, encodes each reading, and sends it to the device's `gamepad` endpoint.

```ts
import { attachGamepad, Button, isPressed } from '@mazupo/client/gamepad';
import { useGamepad, GamepadView } from '@mazupo/client/gamepad/react';
```

`react` is an optional peer dependency, needed only for the second entry point. `GamepadView` draws with SVG and works on the web only. The first entry point also works in React Native.

See the [Gamepad guide](../guides/gamepad.md) for examples.

## The device must listen

```bash
pi-webrtc --enable-gamepad ...
```

`--enable-gamepad` also turns on `--enable-ipc`. Without it, the readings are sent but dropped.

pi-webrtc writes the latest state of every gamepad to a Unix socket, as one JSON line per update. See [Gamepad in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/integrations/gamepad) for the format.

## Exports

| Export | Description |
| --- | --- |
| `attachGamepad(camera, options?)` | Reads a controller into a `PiCamera`. Returns the sampler, already running. |
| `GamepadSampler` | The reading loop: `start()`, `stop()`, `onSnapshot()`, `onButton()`, `onButtonChange()`, `onSuspend()`, `setSink()`, `.snapshot`, `.sampling` |
| `toSnapshot(gamepad)` | Turns a browser `Gamepad` into a plain snapshot. |
| `isPressed(snapshot, index)` / `Button` | Read the button bits. |
| `sameSnapshot(a, b)` | Whether two readings would drive the device the same way. |
| `InputReport`, `GamepadInput` | The generated protobuf types. |
| `useGamepad(options)` <sup>react</sup> | Runs a sampler while a component is mounted. |
| `GamepadView` <sup>react</sup> | The SVG view. |

`attachGamepad(camera, options?)` is the whole setup. You can call it before or after `connect()`: a reading taken before the connection is up is dropped, and sending starts when the channel opens. It uses [canSend](methods.md#cansend) to decide. `GamepadSampler` is the same loop without the camera, for driving it by hand or sending somewhere else. Its `setSink()` changes the destination. It does not follow a connection.

`buttons` is a bit field: bit *n* is `buttons[n].pressed` in the standard mapping. Read it with `isPressed(snapshot, Button.Start)`. An axis or a button that the controller does not report reads as centered or released, and does not throw.

`onButton` and `onButtonChange` fire once on press and once on release, never while a button is held. They run whether or not a sink is set. Both return a function that removes the listener. If a controller is unplugged while a button is held, it reports the button as released, so a toggle cannot stay on.

## Options

Taken by `attachGamepad`, `useGamepad` and the `GamepadSampler` constructor.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| hz | `number` | `60` | Readings per second. |
| endpoint | `string` | `gamepad` | The device IPC endpoint that each reading goes to. |
| sampleWhileHidden | `boolean` | `false` | Keep reading while the page is hidden. |
| sink | `IpcSink \| null` | | The destination, for `GamepadSampler` only. `attachGamepad` and `useGamepad` take the camera instead. |

Anything with `sendToEndpoint` is an `IpcSink`, exported from the main entry point. `PiCamera` is one.

## Behavior

- Reads on a fixed timer, not with `requestAnimationFrame`. The device takes a steady stream of readings as proof that the link is alive, so the rate must not follow the display.
- Stops while the page is hidden. `sampleWhileHidden: true` changes that.
- Numbers every message, so the device can drop an old reading that arrives late on the unordered lossy channel.
- Sends nothing for a controller outside the W3C standard mapping, and reports it as `standardMapping: false`. Its fields would not mean what their names say.
- `start()` can be called again safely, and a second controller does not start a second loop.
- Applies no dead zone. pi-webrtc applies its own, and splitting that decision between two codebases would drift.
