import { Queue } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { testRedisUrl } from '@archova/testing';
import { LAG_ALERT_MS, measureQueue } from '../../src/ai/queue-age';
import { connectionFor } from '../../src/queues';

const redisUrl = testRedisUrl();

describe.runIf(redisUrl)('the queue age on a real queue', () => {
  const prefix = `t${Date.now()}`;
  const queue = new Queue('subscribers-ai', { connection: connectionFor(redisUrl!), prefix });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  const min = (n: number) => n * 60_000;

  it('finds an old job waiting for its retry behind a fresh waiting one', async () => {
    const now = Date.now();
    await queue.add('fresh', {}, { jobId: 'fresh-1', timestamp: now - 1_000 });
    // As after a failed attempt: created long ago, parked in the delayed set until the retry is due.
    await queue.add('old', {}, { jobId: 'old-1', timestamp: now - min(20), delay: min(5) });

    const age = await measureQueue(queue, now);
    expect(age).toMatchObject({ queue: 'subscribers-ai', waiting: 1, retrying: 1, active: 0 });
    expect(age.oldestMs).toBeGreaterThanOrEqual(min(20));
    expect(age.oldestMs).toBeGreaterThan(LAG_ALERT_MS);
  });

  it('finds an old job that sits behind newer ones in the waiting list', async () => {
    const q = new Queue('subscribers-ai-2', { connection: connectionFor(redisUrl!), prefix });
    try {
      const now = Date.now();
      // A retry promoted from the delayed set joins the waiting list behind jobs made after it.
      await q.add('newer-a', {}, { jobId: 'a', timestamp: now - 2_000 });
      await q.add('newer-b', {}, { jobId: 'b', timestamp: now - 1_000 });
      await q.add('promoted', {}, { jobId: 'p', timestamp: now - min(12) });

      expect((await measureQueue(q, now)).oldestMs).toBeGreaterThanOrEqual(min(12));
    } finally {
      await q.obliterate({ force: true });
      await q.close();
    }
  });

  it('says zero for an empty queue', async () => {
    const q = new Queue('subscribers-ai-3', { connection: connectionFor(redisUrl!), prefix });
    try {
      expect(await measureQueue(q, Date.now())).toMatchObject({
        waiting: 0,
        retrying: 0,
        active: 0,
        oldestMs: 0,
      });
    } finally {
      await q.close();
    }
  });
});
