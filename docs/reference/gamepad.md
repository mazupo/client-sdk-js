# Gamepad

Sends a controller to the device's `gamepad` endpoint. Every [connection](connection.md#gamepad) has `gamepad()`. The entry points below add button names, a React hook and a view.

```ts
import { Button, isPressed } from '@mazupo/client/gamepad';
import { useGamepad, GamepadView } from '@mazupo/client/gamepad/react';
```

`react` is an optional peer dependency, needed only for the second entry point. `GamepadView` draws with SVG and works on the web only. The rest also works in React Native.

See the [Gamepad guide](../guides/gamepad.md) for examples.

## The device must listen

```bash
pi-webrtc --enable-gamepad ...
```

`--enable-gamepad` also turns on `--enable-ipc`. Without it, the readings are sent but dropped.

pi-webrtc writes the latest state of every gamepad to a Unix socket, as one JSON line per update. See [Gamepad in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/integrations/gamepad) for the format.

## connection.gamepad

`connection.gamepad(options?)` returns a running `GamepadSampler`. Call it before or after `connect()`.

A connection has one gamepad. Calling `gamepad()` again returns the same sampler.

`disconnect()` stops it. `stop()` stops it too, and keeps the connection.

In a room, the readings go where `sendText()` goes. Pass `deviceIds` to send only to those devices:

```javascript
room.gamepad({ deviceIds: ['rudder'] });
```

## Exports

| Export | Description |
| --- | --- |
| `GamepadSampler` | The reading loop: `start()`, `stop()`, `onSnapshot()`, `onButton()`, `onButtonChange()`, `onSuspend()`, `.snapshot`, `.sampling`. `connection.gamepad()` returns one. `new GamepadSampler()` reads a pad without sending anything. |
| `toSnapshot(gamepad)` | Turns a browser `Gamepad` into a plain snapshot. |
| `isPressed(snapshot, index)` / `Button` | Read the button bits. |
| `sameSnapshot(a, b)` | Whether two readings would drive the device the same way. |
| `InputReport`, `GamepadInput` | The generated protobuf types. |
| `useGamepad(connection, options?)` <sup>react</sup> | Sends a gamepad to a connection while a component is mounted. |
| `GamepadView` <sup>react</sup> | The SVG view. |

`buttons` is a bit field in the standard mapping. Read it with `isPressed(snapshot, Button.Start)`.

`onButton` and `onButtonChange` fire on press and on release. Both return a function that removes the listener.

## useGamepad

`useGamepad(connection: Connection | null, options?)` returns `{ connected, suspended, sampler }`.

- Pass `null` before there is a connection. The pad is still read, so `<GamepadView>` can show it.
- When you pass a connection, the hook uses that connection's gamepad.
- `connected` is whether a pad is reporting. `suspended` is why reading stopped, or `null`.
- Only `connected` and `suspended` go into React state. The readings arrive 60 times a second and go straight to the view.

## Options

Taken by `connection.gamepad()`, `useGamepad` and the `GamepadSampler` constructor.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| hz | `number` | `60` | Readings per second. |
| endpoint | `string` | `gamepad` | The device IPC endpoint that each reading goes to. |
| sampleWhileHidden | `boolean` | `false` | Keep reading while the page is hidden. |
| deviceIds | `string[]` | | In a room: only these devices. Not for `GamepadSampler`. |

`hz`, `endpoint` and `sampleWhileHidden` apply when the connection's gamepad is made, at the first `gamepad()` call.

## Behavior

- Reads on a fixed timer, not with `requestAnimationFrame`. The device takes a steady stream of readings as proof that the link is alive, so the rate must not follow the display.
- Stops while the page is hidden. `sampleWhileHidden: true` changes that.
- Numbers every message, so the device can drop an old reading that arrives late on the unordered lossy channel.
- Sends nothing for a controller outside the W3C standard mapping, and reports it as `standardMapping: false`. Its fields would not mean what their names say.
- `start()` can be called again safely, and a second controller does not start a second loop.
- Applies no dead zone. pi-webrtc applies its own, and splitting that decision between two codebases would drift.
