import { Queue } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { testRedisUrl } from '@archova/testing';
import { connectionFor, dispatch, eventsPublisher } from '../../src/queues';
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
});
