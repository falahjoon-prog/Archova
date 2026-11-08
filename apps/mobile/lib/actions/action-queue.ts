// Actions taken with no signal: a submittal response, or submitting, approving or rejecting a timesheet. Each is kept
// on the phone with its time and replayed oldest first when the connection returns, through the same REST calls the
// online screens use. The server remains the authority: if it refuses (the sheet was approved elsewhere, the person
// is no longer the reviewer) the entry is kept as refused with the reason, so the screen can say so instead of
// pretending it was sent.

import { ApiError } from '@archova/api-client';
import type { SqlDatabase } from '../db/sql';
import { isOfflineError } from '../attendance/sign-in-queue';

export { isOfflineError };

export type ActionKind =
  'submittal.respond' | 'timesheet.submit' | 'timesheet.approve' | 'timesheet.reject';

export interface QueuedAction {
  id: string;
  projectId: string;
  kind: ActionKind;
  /** The submittal or timesheet the action is on. */
  targetId: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'refused';
  lastError: string | null;
  attempts: number;
  createdAt: string;
}

/** Sends one action; throws `ApiError` for a refusal and anything else for a lost connection. */
export type ActionSender = (action: QueuedAction) => Promise<void>;

export interface ActionDrainResult {
  sent: number;
  refused: number;
  retry: boolean;
}

interface Row {
  id: string;
  project_id: string;
  kind: ActionKind;
  target_id: string;
  payload: string;
  state: 'pending' | 'refused';
  last_error: string | null;
  attempts: number;
  created_at: string;
}

const toAction = (r: Row): QueuedAction => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  targetId: r.target_id,
  payload: JSON.parse(r.payload) as Record<string, unknown>,
  state: r.state,
  lastError: r.last_error,
  attempts: r.attempts,
  createdAt: r.created_at,
});

/** A refusal replaying cannot fix. Only a lost connection, timeout, rate limit or server fault is worth retrying. */
function isFinalRefusal(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.status !== 0 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

export class ActionQueue {
  constructor(
    private readonly db: SqlDatabase,
    private readonly send: ActionSender,
    private readonly now: () => number = Date.now,
  ) {}

  async enqueue(a: Pick<QueuedAction, 'id' | 'projectId' | 'kind' | 'targetId' | 'payload'>) {
    await this.db.runAsync(
      `INSERT OR IGNORE INTO action_queue (id, project_id, kind, target_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        a.id,
        a.projectId,
        a.kind,
        a.targetId,
        JSON.stringify(a.payload),
        new Date(this.now()).toISOString(),
      ],
    );
  }

  /** Waiting and refused actions for a project, oldest first. */
  async list(projectId: string): Promise<QueuedAction[]> {
    const rows = await this.db.getAllAsync<Row>(
      'SELECT * FROM action_queue WHERE project_id = ? ORDER BY created_at, id',
      [projectId],
    );
    return rows.map(toAction);
  }

  /** Pending actions on one submittal or timesheet, so its screen can say what is waiting. */
  async forTarget(targetId: string): Promise<QueuedAction[]> {
    const rows = await this.db.getAllAsync<Row>(
      'SELECT * FROM action_queue WHERE target_id = ? ORDER BY created_at, id',
      [targetId],
    );
    return rows.map(toAction);
  }

  /** Removes an entry the person has seen (a refusal) or no longer wants (a pending one). */
  async discard(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM action_queue WHERE id = ?', [id]);
  }

  /** Replays pending actions oldest first; stops at the first lost connection so order is kept. */
  async drain(): Promise<ActionDrainResult> {
    const result: ActionDrainResult = { sent: 0, refused: 0, retry: false };
    const rows = await this.db.getAllAsync<Row>(
      "SELECT * FROM action_queue WHERE state = 'pending' ORDER BY created_at, id",
    );
    for (const row of rows) {
      try {
        await this.send(toAction(row));
        await this.discard(row.id);
        result.sent++;
      } catch (e) {
        if (isFinalRefusal(e)) {
          await this.db.runAsync(
            "UPDATE action_queue SET state = 'refused', last_error = ?, attempts = attempts + 1 WHERE id = ?",
            [e instanceof Error ? e.message : 'Refused', row.id],
          );
          result.refused++;
        } else {
          await this.db.runAsync('UPDATE action_queue SET attempts = attempts + 1 WHERE id = ?', [
            row.id,
          ]);
          result.retry = true;
          return result;
        }
      }
    }
    return result;
  }
}
