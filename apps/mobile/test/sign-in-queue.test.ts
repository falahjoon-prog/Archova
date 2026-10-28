import { ApiError } from '@archova/api-client';
import { describe, expect, it } from 'vitest';
import { migrate } from '../lib/db';
import { isOfflineError, SignInQueue, type QueuedSignIn } from '../lib/attendance/sign-in-queue';
import { nodeSqlDriver } from './support/node-sql';

async function setup(send: (e: QueuedSignIn) => Promise<void>) {
  const db = await nodeSqlDriver().open('test.db');
  await migrate(db);
  let now = Date.parse('2026-10-28T20:00:00.000Z');
  const queue = new SignInQueue(db, send, () => (now += 1000));
  return { queue };
}

const scan = (n: number) => ({
  idempotencyKey: `key-${n}`,
  projectId: 'prj_1',
  gateCode: 'gqr_x',
  clientAt: `2026-10-28T19:0${n}:00.000Z`,
});

describe('gate sign-in queue', () => {
  it('replays scans oldest first and empties the queue', async () => {
    const sent: string[] = [];
    const { queue } = await setup(async (e) => void sent.push(e.idempotencyKey));
    await queue.enqueue(scan(1));
    await queue.enqueue(scan(2));
    expect(await queue.drain()).toEqual({ sent: 2, refused: 0, retry: false });
    expect(sent).toEqual(['key-1', 'key-2']);
    expect(await queue.pending()).toEqual([]);
  });

  it('queues the same scan once', async () => {
    const { queue } = await setup(async () => {});
    await queue.enqueue(scan(1));
    await queue.enqueue(scan(1));
    expect(await queue.pending()).toHaveLength(1);
  });

  it('stops at a lost connection, keeps the scan and its key, and counts the attempt', async () => {
    const sent: string[] = [];
    let down = true;
    const { queue } = await setup(async (e) => {
      if (down) throw new TypeError('Network request failed');
      sent.push(e.idempotencyKey);
    });
    await queue.enqueue(scan(1));
    await queue.enqueue(scan(2));
    expect((await queue.drain()).retry).toBe(true);
    const [first] = await queue.pending();
    expect(first).toMatchObject({ idempotencyKey: 'key-1', attempts: 1 });
    down = false;
    expect(await queue.drain()).toEqual({ sent: 2, refused: 0, retry: false });
    expect(sent).toEqual(['key-1', 'key-2']);
  });

  it('drops a scan the server refuses for good and carries on', async () => {
    const sent: string[] = [];
    const { queue } = await setup(async (e) => {
      if (e.idempotencyKey === 'key-1') throw new ApiError(403, null);
      sent.push(e.idempotencyKey);
    });
    await queue.enqueue(scan(1));
    await queue.enqueue(scan(2));
    expect(await queue.drain()).toEqual({ sent: 1, refused: 1, retry: false });
    expect(sent).toEqual(['key-2']);
  });

  it('retries on a server error and on a rate limit', async () => {
    for (const status of [500, 503, 429, 409]) {
      const { queue } = await setup(async () => {
        throw new ApiError(status, null);
      });
      await queue.enqueue(scan(1));
      expect((await queue.drain()).retry).toBe(true);
      expect(await queue.pending()).toHaveLength(1);
    }
  });

  it('filters pending by project', async () => {
    const { queue } = await setup(async () => {});
    await queue.enqueue(scan(1));
    await queue.enqueue({ ...scan(2), projectId: 'prj_2' });
    expect((await queue.pending('prj_2')).map((e) => e.idempotencyKey)).toEqual(['key-2']);
  });

  it('tells a missing connection from a refusal', () => {
    expect(isOfflineError(new TypeError('Network request failed'))).toBe(true);
    expect(isOfflineError(new ApiError(0, null))).toBe(true);
    expect(isOfflineError(new ApiError(403, null))).toBe(false);
    expect(isOfflineError(new Error('x'))).toBe(false);
  });
});
