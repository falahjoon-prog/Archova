// Gate sign-ins scanned with no signal (ATT-AC9). The scan is kept on the phone with its time and replayed in
// order when the connection returns. The worker is not on the site list until then, so the screen says so.

import { ApiError, unwrap, type ApiClient } from '@archova/api-client';
import type { SqlDatabase } from '../db/sql';

export interface QueuedSignIn {
  idempotencyKey: string;
  projectId: string;
  gateCode: string;
  clientAt: string;
  attempts: number;
}

/** Sends one queued sign-in; throws `ApiError` for a refusal and anything else for a lost connection. */
export type SignInSender = (entry: QueuedSignIn) => Promise<void>;

export interface SignInDrainResult {
  sent: number;
  /** The server refused these for good (for example a revoked gate code); they are dropped. */
  refused: number;
  /** The connection is still down or the server is struggling; try again later. */
  retry: boolean;
}

interface Row {
  idempotency_key: string;
  project_id: string;
  gate_code: string;
  client_at: string;
  attempts: number;
}

/** True when the request never got an answer, so queueing the scan is the right response. */
export function isOfflineError(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 0;
  return e instanceof TypeError;
}

/** A refusal that replaying cannot fix. 408, 409 and 429 and every 5xx are worth another try. */
function isFinalRefusal(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status === 0 || e.status >= 500) return false;
  return e.status !== 408 && e.status !== 409 && e.status !== 429;
}

export class SignInQueue {
  constructor(
    private readonly db: SqlDatabase,
    private readonly send: SignInSender,
    private readonly now: () => number = Date.now,
  ) {}

  async enqueue(entry: Omit<QueuedSignIn, 'attempts'>): Promise<void> {
    await this.db.runAsync(
      `INSERT OR IGNORE INTO gate_queue (idempotency_key, project_id, gate_code, client_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.idempotencyKey,
        entry.projectId,
        entry.gateCode,
        entry.clientAt,
        new Date(this.now()).toISOString(),
      ],
    );
  }

  async pending(projectId?: string): Promise<QueuedSignIn[]> {
    const rows =
      projectId === undefined
        ? await this.db.getAllAsync<Row>('SELECT * FROM gate_queue ORDER BY created_at, client_at')
        : await this.db.getAllAsync<Row>(
            'SELECT * FROM gate_queue WHERE project_id = ? ORDER BY created_at, client_at',
            [projectId],
          );
    return rows.map((r) => ({
      idempotencyKey: r.idempotency_key,
      projectId: r.project_id,
      gateCode: r.gate_code,
      clientAt: r.client_at,
      attempts: r.attempts,
    }));
  }

  /** Replays the queue oldest first and stops at the first lost connection, so order is kept. */
  async drain(): Promise<SignInDrainResult> {
    const result: SignInDrainResult = { sent: 0, refused: 0, retry: false };
    for (const entry of await this.pending()) {
      try {
        await this.send(entry);
        result.sent++;
      } catch (e) {
        if (isFinalRefusal(e)) {
          result.refused++;
        } else {
          await this.db.runAsync(
            'UPDATE gate_queue SET attempts = attempts + 1 WHERE idempotency_key = ?',
            [entry.idempotencyKey],
          );
          result.retry = true;
          return result;
        }
      }
      await this.db.runAsync('DELETE FROM gate_queue WHERE idempotency_key = ?', [
        entry.idempotencyKey,
      ]);
    }
    return result;
  }
}

/** Replays a queued scan through the typed client, marked as queued (`offline`). */
export function createSignInSender(api: ApiClient, orgId: string): SignInSender {
  return async (entry) => {
    unwrap(
      await api.POST('/v1/orgs/{orgId}/projects/{projectId}/attendance/sign-in', {
        params: {
          path: { orgId, projectId: entry.projectId },
          header: { 'Idempotency-Key': entry.idempotencyKey },
        },
        body: { gateCode: entry.gateCode, clientAt: entry.clientAt, offline: true },
      }),
    );
  };
}
