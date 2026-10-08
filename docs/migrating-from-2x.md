# Migrating from picamera.js 2.x to @mazupo/client 3.0

Three things changed at once: the package moved to the `mazupo` org, the public API
dropped its Hungarian-style prefixes, and the wire protocol was redesigned.

The protocol is the one that cannot be worked around — read that section first.

## The device has to move too

`packet.proto` was redesigned. Field 1 of `Packet` used to be a `CommandType` enum and is
now a `request_id` string, and the payload arms were regrouped into `Request` / `Response` /
`Stream` / `Ipc`. Nothing about the two formats is compatible.

**A 3.x client cannot talk to a 2.x device, and a 2.x client cannot talk to a 3.x device.**
Upgrade [pi-webrtc](https://github.com/mazupo/pi-webrtc) to 3.x at the same time. There is no
negotiation step that detects this, so a mismatched pair connects and then fails to make
sense of each other's messages.

## Install

```bash
npm uninstall picamera.js
npm install @mazupo/client
```

`picamera.js` is deprecated and receives no further releases. Every import path changes:

```diff
- import { PiCamera } from 'picamera.js';
+ import { PiCamera } from '@mazupo/client';
```

## Renamed exports

The `I` prefix is gone from every interface.

| 2.x | 3.0 |
| --- | --- |
| `IPiCameraOptions` | `PiCameraOptions` |
| `ILiveKitConnectionOptions` | `LiveKitConnectionOptions` |
| `IApiConnectionOptions` | `ApiConnectionOptions` |
| `ChannelId` | `ChannelRole` |
| `CommandType` | `RequestType` |

`onQuility` — a misspelling shipped in every release since 1.0.8 — is now `onQuality`:

```diff
- camera.onQuility = (quality) => { ... };
+ camera.onQuality = (quality) => { ... };
```

New in 3.0: `IpcMode`, and `Participant` / `Quality` / `Speaking`, which used to be reachable
only by deep import (see below).

## `ChannelId` → `ChannelRole`: the numbers moved

`ChannelRole` adds a `Stream` member in the middle, so every value after it shifted.

| Member | 2.x (`ChannelId`) | 3.0 (`ChannelRole`) |
| --- | --- | --- |
| `Command` | 0 | 0 |
| `Stream` | — | 1 |
| `Lossy` | 1 | 2 |
| `Reliable` | 2 | 3 |

Comparing against the enum keeps working:

```diff
- camera.onDatachannel = (id) => { if (id === ChannelId.Reliable) ... };
+ camera.onDatachannel = (role) => { if (role === ChannelRole.Reliable) ... };
```

Comparing against a **number** now silently matches the wrong channel. If you stored or
transmitted these values anywhere, they need remapping.

`onDatachannel` also fires for the new `Stream` role, which carries everything chunked —
snapshots, video lists, file transfers. Code that assumed three channels will see a fourth.

## `CommandType` → `RequestType`: not just a rename

`CommandType` was a numeric enum generated from the proto. `RequestType` is a **string** enum
declared by this package, whose values are the payload field names on `Request`.

| 2.x `CommandType` | 3.0 `RequestType` |
| --- | --- |
| `DISCONNECT` = 0 | `Disconnect` = `'disconnect'` |
| `CONTROL_CAMERA` = 1 | `ControlCamera` = `'controlCamera'` |
| `TAKE_SNAPSHOT` = 2 | `TakeSnapshot` = `'takeSnapshot'` |
| `QUERY_FILE` = 3 | `QueryFile` = `'queryFile'` |
| `TRANSFER_FILE` = 4 | `TransferFile` = `'transferFile'` |
| `START_RECORDING` = 5 | `StartRecording` = `'startRecording'` |
| `STOP_RECORDING` = 6 | `StopRecording` = `'stopRecording'` |
| `TOGGLE_TRACKING` = 7 | `ToggleTracking` = `'toggleTracking'` |
| `CUSTOM` = 100 | `Ipc` = `'ipc'` |

The names are PascalCase rather than SCREAMING_SNAKE, and the values are strings. Anything
that persisted a `CommandType` number has to be remapped.

## IPC mode is per message, not per connection

`ipcMode` was a constructor option, so every IPC message on a connection went out the same
way. It is now an argument, defaulting to `'reliable'`.

```diff
  const camera = new PiCamera({
    uid: 'your-custom-uid',
-   ipcMode: 'lossy',
  });

- camera.sendText('hello');
+ camera.sendText('hello', 'lossy');
```

`sendData` takes the same second argument. Both still default to `'reliable'`, so calls that
never set `ipcMode` need no change.

## Deep imports are gone

2.x shipped `"./*": "./build/*.js"` in its exports map, which made every file under `build/`
importable — and therefore public API. That is removed.

```diff
- import { Participant, Quality, Speaking } from 'picamera.js/signaling/livekit-client';
+ import { Participant, Quality, Speaking } from '@mazupo/client';
```

Those three types were the only ones the wildcard was really carrying, and they now come from
the main entry. If you were reaching for something else under `build/`, open an issue rather
than working around it — it was never meant to be importable.

## Build output

The IIFE builds are gone. They were emitted without a `globalName`, so a `<script>` tag got
nothing out of them; nothing could have depended on them working.

| 2.x | 3.0 |
| --- | --- |
| `dist/picamera.esm.js` | `dist/index.esm.js` |
| `dist/picamera.js` | removed |
| `dist/picamera.min.js` | removed |

From a CDN:

```diff
- import { PiCamera } from 'https://cdn.jsdelivr.net/npm/picamera.js@latest/dist/picamera.esm.js';
+ import { PiCamera } from 'https://cdn.jsdelivr.net/npm/@mazupo/client@3/dist/index.esm.js';
```

## Gamepad support

New in 3.0, and the reason `@pi-webrtc/gamepad` was never published separately:

```ts
import { attachGamepad, Button } from '@mazupo/client/gamepad';
import { useGamepad, GamepadView } from '@mazupo/client/gamepad/react';

const pad = attachGamepad(camera);
```

React is an optional peer dependency, needed only for the `/gamepad/react` entry point.
See the [API reference](reference/README.md) for the rest.

## License

3.0 is licensed under **Apache-2.0**. Releases up to 2.1.2 remain AGPL-3.0.

If you stayed on 2.x because of the AGPL, or held a commercial licence for it, note that
Apache-2.0 already permits proprietary use — there is nothing left to license separately.
