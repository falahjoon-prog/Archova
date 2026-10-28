import type pg from 'pg';

/** What the relay may see of an outbox row: routing columns only (the app_platform grant stops there). */
export interface RelayedEvent {
  id: string;
  orgId: string;
  type: string;
}

export type Publish = (events: readonly RelayedEvent[]) => Promise<void>;

export const RELAY_BATCH = 500;

/**
 * One relay pass (backend 05 §1): lock up to `limit` unpublished rows in order, hand them to `publish`, and mark
 * them published, all in one transaction. If `publish` throws, nothing is marked and the next pass retries, so
 * delivery is at-least-once; the queue's job id (the event id) collapses duplicates. Returns how many were relayed.
 * Several relays can run at once: SKIP LOCKED gives each its own rows.
 */
export async function relayOnce(
  pool: pg.Pool,
  publish: Publish,
  limit: number = RELAY_BATCH,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string; org_id: string; type: string }>(
      `select id, org_id, type from shared.outbox
        where published_at is null
        order by occurred_at, id
        limit $1
        for update skip locked`,
      [limit],
    );
    if (rows.length === 0) {
      await client.query('commit');
      return 0;
    }
    await publish(rows.map((r) => ({ id: r.id, orgId: r.org_id, type: r.type })));
    await client.query('update shared.outbox set published_at = now() where id = any($1::uuid[])', [
      rows.map((r) => r.id),
    ]);
    await client.query('commit');
    return rows.length;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Runs passes back to back while there is a backlog, then waits `idleMs`. Stops when `signal` aborts. */
export async function runRelay(
  pool: pg.Pool,
  publish: Publish,
  signal: AbortSignal,
  opts: { idleMs?: number; onError?: (err: unknown) => void } = {},
): Promise<void> {
  const idleMs = opts.idleMs ?? 250;
  while (!signal.aborted) {
    let n = 0;
    try {
      n = await relayOnce(pool, publish);
    } catch (err) {
      opts.onError?.(err);
    }
    if (n < RELAY_BATCH) await sleep(idleMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
