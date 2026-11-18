// Runs an action online, or keeps it on the phone to send when the connection returns (see lib/actions/attempt.ts).
import { useCallback } from 'react';
import { attemptOrQueue, type AttemptOutcome } from '../lib/actions/attempt';
import type { ActionKind } from '../lib/actions/action-queue';
import { useDeviceData } from './device-data';

export interface AttemptInput {
  /** Reuse as the idempotency key when the action is replayed. */
  id?: string;
  projectId: string;
  kind: ActionKind;
  targetId: string;
  payload: Record<string, unknown>;
}

export function useAttempt() {
  const device = useDeviceData();
  return useCallback(
    (action: AttemptInput, online: () => Promise<unknown>): Promise<AttemptOutcome> =>
      attemptOrQueue(device.status === 'ready' ? device.data.actions : null, action, online, () => {
        if (device.status === 'ready') device.data.requestSync('connectivity');
      }),
    [device],
  );
}
