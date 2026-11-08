import { ApiError } from '@archova/api-client';
import { describe, expect, it } from 'vitest';
import { migrate } from '../lib/db';
import { ActionQueue, type ActionSender, type QueuedAction } from '../lib/actions/action-queue';
import { attemptOrQueue } from '../lib/actions/attempt';
import { nodeSqlDriver } from './support/node-sql';

async function setup(send: ActionSender) {
  const db = await nodeSqlDriver().open('test.db');
  await migrate(db);
  let now = Date.parse('2026-11-07T00:00:00.000Z');
  return new ActionQueue(db, send, () => (now += 1000));
}

const action = (id: string, kind: QueuedAction['kind'] = 'timesheet.approve') => ({
  id,
  projectId: 'prj_1',
  kind,
  targetId: 'tsh_1',
  payload: {},
});
const apiError = (status: number) => new ApiError(status, { title: 'x' } as never);

describe('action queue', () => {
  it('replays actions oldest first and empties the queue', async () => {
    const sent: string[] = [];
    const q = await setup(async (a) => void sent.push(a.id));
    await q.enqueue(action('a1'));
    await q.enqueue(action('a2', 'timesheet.submit'));
    expect(await q.drain()).toEqual({ sent: 2, refused: 0, retry: false });
    expect(sent).toEqual(['a1', 'a2']);
    expect(await q.list('prj_1')).toEqual([]);
  });

  it('keeps the payload and queues the same action once', async () => {
    const q = await setup(async () => {});
    await q.enqueue({
      ...action('a1', 'submittal.respond'),
      payload: { stepId: 's', response: 'approved' },
    });
    await q.enqueue(action('a1'));
    const rows = await q.forTarget('tsh_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'submittal.respond',
      payload: { stepId: 's', response: 'approved' },
    });
  });

  it('stops at a lost connection, keeps the order and counts the attempt', async () => {
    let calls = 0;
    const q = await setup(async () => {
      calls++;
      throw new TypeError('Network request failed');
    });
    await q.enqueue(action('a1'));
    await q.enqueue(action('a2'));
    expect(await q.drain()).toEqual({ sent: 0, refused: 0, retry: true });
    expect(calls).toBe(1);
    const rows = await q.list('prj_1');
    expect(rows.map((r) => [r.id, r.state, r.attempts])).toEqual([
      ['a1', 'pending', 1],
      ['a2', 'pending', 0],
    ]);
  });

  it('keeps a refused action with its reason and carries on with the next', async () => {
    const sent: string[] = [];
    const q = await setup(async (a) => {
      if (a.id === 'a1') throw apiError(409);
      sent.push(a.id);
    });
    await q.enqueue(action('a1'));
    await q.enqueue(action('a2'));
    expect(await q.drain()).toEqual({ sent: 1, refused: 1, retry: false });
    expect(sent).toEqual(['a2']);
    const rows = await q.list('prj_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a1', state: 'refused' });
    // A refused action is not replayed again.
    expect(await q.drain()).toEqual({ sent: 0, refused: 0, retry: false });
  });

  it('retries a server fault and a rate limit instead of refusing', async () => {
    for (const status of [500, 429]) {
      const q = await setup(async () => {
        throw apiError(status);
      });
      await q.enqueue(action('a1'));
      expect(await q.drain()).toMatchObject({ refused: 0, retry: true });
    }
  });

  it('discards an entry', async () => {
    const q = await setup(async () => {});
    await q.enqueue(action('a1'));
    await q.discard('a1');
    expect(await q.list('prj_1')).toEqual([]);
  });
});

describe('attemptOrQueue', () => {
  const queue = () => {
    const saved: unknown[] = [];
    return { saved, enqueue: async (a: unknown) => void saved.push(a) };
  };
  it('sends when online and does not queue', async () => {
    const q = queue();
    expect(await attemptOrQueue(q, action('x'), async () => {})).toBe('sent');
    expect(q.saved).toHaveLength(0);
  });
  it('queues when the request never got an answer', async () => {
    const q = queue();
    let woke = false;
    const out = await attemptOrQueue(
      q,
      action('x'),
      async () => {
        throw new TypeError('offline');
      },
      () => (woke = true),
    );
    expect(out).toBe('queued');
    expect(q.saved).toHaveLength(1);
    expect(woke).toBe(true);
  });
  it('shows a server refusal now instead of queueing it', async () => {
    const q = queue();
    await expect(
      attemptOrQueue(q, action('x'), async () => {
        throw apiError(403);
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(q.saved).toHaveLength(0);
  });
  it('rethrows when there is no device storage', async () => {
    await expect(
      attemptOrQueue(null, action('x'), async () => {
        throw new TypeError('offline');
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
