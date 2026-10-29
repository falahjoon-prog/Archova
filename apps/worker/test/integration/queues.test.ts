import { Queue, Worker } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { testRedisUrl } from '@archova/testing';
import {
  ROUTED_RETRY,
  connectionFor,
  dispatch,
  eventsPublisher,
  maintenanceBulk,
} from '../../src/queues';
import type { Subscriber } from '../../src/subscribers';

const redisUrl = testRedisUrl();

describe.runIf(redisUrl)('queues', () => {
  const prefix = `t${Date.now()}`;
  const events = new Queue('events', { connection: connectionFor(redisUrl!), prefix });
  const subs = new Queue('subscribers', { connection: connectionFor(redisUrl!), prefix });
  afterAll(async () => {
    await events.obliterate({ force: true });
    await subs.obliterate({ force: true });
    await Promise.all([events.close(), subs.close()]);
  });

  it('publishes each event once even when the relay replays a batch', async () => {
    const publish = eventsPublisher(events);
    const batch = [
      { id: 'e-1', orgId: 'o', type: 'a.b.c.v1' },
      { id: 'e-2', orgId: 'o', type: 'a.b.c.v1' },
    ];
    await publish(batch);
    await publish(batch);
    expect(await events.getJobCountByTypes('waiting')).toBe(2);
  });

  it('fans out one job per matching subscriber and dedupes on replay', async () => {
    const reg: Subscriber[] = [
      { name: 'audit', types: ['*'], handle: async () => {} },
      { name: 'search', types: ['a.*'], handle: async () => {} },
      { name: 'other', types: ['z.*'], handle: async () => {} },
    ];
    const ev = { id: 'e-9', orgId: 'o', type: 'a.b.c.v1' };
    expect(await dispatch(ev, reg, subs)).toBe(2);
    await dispatch(ev, reg, subs);
    expect(await subs.getJobCountByTypes('waiting')).toBe(2);
    expect(await subs.getJob('e-9.audit')).toBeTruthy();
  });

  it('retries a routed job on the capped backoff until it succeeds', async () => {
    const aiSubs = new Queue('subscribers-ai', { connection: connectionFor(redisUrl!), prefix });
    const reg: Subscriber[] = [
      { name: 'ai.x', types: ['a.*'], queue: 'ai', handle: async () => {} },
    ];
    await dispatch({ id: 'e-ai', orgId: 'o', type: 'a.b.c.v1' }, reg, subs, { ai: aiSubs });
    expect(await subs.getJob('e-ai.ai.x')).toBeUndefined();
    const job = await aiSubs.getJob('e-ai.ai.x');
    expect(job?.opts).toMatchObject({
      attempts: ROUTED_RETRY.attempts,
      backoff: { type: 'capped', delay: 2000 },
    });

    // The type name reaches the worker's own strategy (here 20 ms instead of 2 s), so BullMQ does not reject it.
    const waits: number[] = [];
    let tries = 0;
    const worker = new Worker(
      'subscribers-ai',
      async () => {
        tries++;
        if (tries < 3) throw new Error('database unavailable');
      },
      {
        connection: connectionFor(redisUrl!),
        prefix,
        settings: {
          backoffStrategy: (attemptsMade) => {
            waits.push(attemptsMade);
            return 20;
          },
        },
      },
    );
    try {
      for (let i = 0; i < 100 && (await aiSubs.getJobCountByTypes('completed')) === 0; i++)
        await new Promise((r) => setTimeout(r, 50));
      expect(await aiSubs.getJobCountByTypes('completed')).toBe(1);
      expect(tries).toBe(3);
      expect(waits).toEqual([1, 2]);
    } finally {
      await worker.close();
      await aiSubs.obliterate({ force: true });
      await aiSubs.close();
    }
  });

  it('queues the ai maintenance jobs with the same retries, one per org and period', async () => {
    const aiMaint = new Queue('maintenance-ai', { connection: connectionFor(redisUrl!), prefix });
    try {
      const bulk = maintenanceBulk(aiMaint, true);
      const job = {
        name: 'ai.sweep',
        data: { job: 'ai.sweep', orgId: 'o1' },
        opts: { jobId: 'ai.sweep.o1.2026-10-29' },
      };
      await bulk.addBulk([job]);
      await bulk.addBulk([job]);
      expect(await aiMaint.getJobCountByTypes('waiting')).toBe(1);
      expect((await aiMaint.getJob('ai.sweep.o1.2026-10-29'))?.opts.attempts).toBe(20);
    } finally {
      await aiMaint.obliterate({ force: true });
      await aiMaint.close();
    }
  });
});
