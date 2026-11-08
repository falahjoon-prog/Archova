// Try an action online; if there is no signal, keep it on the phone to be sent later.
import { uuidv7 } from '@archova/domain';
import { isOfflineError, type ActionKind, type ActionQueue } from './action-queue';

export type AttemptOutcome = 'sent' | 'queued';

export async function attemptOrQueue(
  queue: Pick<ActionQueue, 'enqueue'> | null,
  action: {
    projectId: string;
    kind: ActionKind;
    targetId: string;
    payload: Record<string, unknown>;
  },
  online: () => Promise<unknown>,
  onQueued?: () => void,
): Promise<AttemptOutcome> {
  try {
    await online();
    return 'sent';
  } catch (e) {
    // Only a request that never got an answer is queued; a refusal from the server is the person's to see now.
    if (!queue || !isOfflineError(e)) throw e;
    await queue.enqueue({ id: uuidv7(), ...action });
    onQueued?.();
    return 'queued';
  }
}

export const ACTION_TEXT: Record<ActionKind, string> = {
  'submittal.respond': 'Submittal response',
  'timesheet.submit': 'Submit timesheet',
  'timesheet.approve': 'Approve timesheet',
  'timesheet.reject': 'Reject timesheet',
};
