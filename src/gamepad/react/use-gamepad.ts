import { useEffect, useMemo, useRef, useState } from 'react';

import type { Connection } from '../../connection/connection';
import type { SfuRoom, SfuRoomDevice, SfuRoomViewer } from '../../connection/sfu-room';
import type { GamepadOptions } from '../../connection/types';
import { GamepadSampler } from '../sampler';
import { SuspendReason } from '../types';

export interface UseGamepadResult {
  /** Whether a pad is currently reporting. */
  connected: boolean;
  /** Why sampling stopped, or null while it is running. */
  suspended: SuspendReason | null;
  /** Hand to `<GamepadView>`, which subscribes directly rather than re-rendering here. */
  sampler: GamepadSampler;
}

export interface UseGamepadOptions extends GamepadOptions {
  /** In a room, only these devices. By default the gamepad goes where `sendText()` goes. */
  deviceIds?: string[];
}

type AnyRoom = SfuRoom<SfuRoomDevice, SfuRoomViewer>;

/** Sends a gamepad to a connection, or only reads it with `null`. State holds only `connected` and `suspended`. */
export function useGamepad(connection: Connection | null = null, options: UseGamepadOptions = {}): UseGamepadResult {
  const { hz, endpoint, sampleWhileHidden, deviceIds } = options;

  const [connected, setConnected] = useState(false);
  const [suspended, setSuspended] = useState<SuspendReason | null>(null);

  // Built once: rebuilding it on an option change would drop the loop mid-flight.
  const standaloneRef = useRef<GamepadSampler | null>(null);
  if (standaloneRef.current === null) {
    standaloneRef.current = new GamepadSampler({ hz, endpoint, sampleWhileHidden });
  }
  const standalone = standaloneRef.current;

  // A connection has one sampler of its own, so its readings carry one sequence.
  const sampler = useMemo(
    () => connection ? connection.gamepad({ hz, endpoint, sampleWhileHidden }) : standalone,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection, standalone],
  );

  const devicesKey = deviceIds?.join('\n');
  useEffect(() => {
    if (connection && 'sendTextTo' in connection) {
      (connection as AnyRoom).gamepad({ deviceIds });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, devicesKey]);

  useEffect(() => {
    const offSnapshot = sampler.onSnapshot((snapshot) => {
      setConnected((was) => {
        const now = snapshot !== null;
        return was === now ? was : now;
      });
      if (snapshot !== null) {
        setSuspended(null);
      }
    });
    const offSuspend = sampler.onSuspend((reason) => setSuspended(reason));

    sampler.start();
    return () => {
      offSnapshot();
      offSuspend();
      sampler.stop();
    };
  }, [sampler]);

  return { connected, suspended, sampler };
}
