import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@archova/kernel';
import { AI_INDEX_ACTOR } from '@archova/mod-ai';
import { ACCOUNTING_PULL_ROUTE, AI_JOBS, AI_SWEEP_ROUTE } from '../../src/ai/declaration';
import { LAG_ALERT_MS, measureQueue, watchQueueAge, type AgeQueue } from '../../src/ai/queue-age';
import { sanitizeFailure } from '../../src/ai/reindex';
import { createSweep, type OrgSweeper } from '../../src/ai/sweep';
import {
  BACKOFF_CAP_MS,
  ROUTED_RETRY,
  cappedBackoff,
  dispatch,
  maintenanceBulk,
} from '../../src/queues';
import type { Subscriber } from '../../src/subscribers';

const ORG = '0192f0a0-0000-7000-8000-000000000001';

describe('retries for work routed to the ai-worker', () => {
  it('doubles from 2 s and never waits more than five minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(cappedBackoff)).toEqual([
      2_000,
      4_000,
      8_000,
      16_000,
      32_000,
      64_000,
      128_000,
      256_000,
      BACKOFF_CAP_MS,
    ]);
    expect(cappedBackoff(20)).toBe(BACKOFF_CAP_MS);
    expect(cappedBackoff(5_000)).toBe(BACKOFF_CAP_MS);
  });

  it('keeps retrying for about an hour before giving up', () => {
    let total = 0;
    for (let n = 1; n < ROUTED_RETRY.attempts; n++) total += cappedBackoff(n);
    expect(total).toBeGreaterThan(50 * 60_000);
    expect(total).toBeLessThan(90 * 60_000);
  });

  it('queues routed subscribers with it, and leaves the default worker on five exponential attempts', async () => {
    const def = { addBulk: vi.fn(async (_jobs: unknown[]) => []) };
    const ai = { addBulk: vi.fn(async (_jobs: unknown[]) => []) };
    const plain: Subscriber = { name: 'audit', types: ['*'], handle: async () => {} };
    const routed: Subscriber = { name: 'ai.x', types: ['*'], queue: 'ai', handle: async () => {} };
    await dispatch({ id: 'e1', orgId: 'o1', type: 'a.b.c.v1' }, [plain, routed], def, { ai });
    expect(ai.addBulk.mock.calls[0]![0]).toMatchObject([
      { opts: { attempts: 20, backoff: { type: 'capped', delay: 2000 } } },
    ]);
    expect(def.addBulk.mock.calls[0]![0]).toMatchObject([
      { opts: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } } },
    ]);
  });

  it('queues the ai maintenance jobs with it, and the default ones as before', async () => {
    const added: Array<{ opts: Record<string, unknown> }> = [];
    const queue = { addBulk: async (jobs: typeof added) => void added.push(...jobs) };
    const job = { name: 'x', data: {}, opts: { jobId: 'x.1' } };
    await maintenanceBulk(queue as never, true).addBulk([job] as never);
    await maintenanceBulk(queue as never).addBulk([job] as never);
    expect(added[0]!.opts).toMatchObject({ jobId: 'x.1', attempts: 20 });
    expect(added[1]!.opts).toMatchObject({ jobId: 'x.1', attempts: 3 });
  });
});

describe('the nightly sweep', () => {
  it('is a per-org job for the ai queue, once a day', () => {
    expect(AI_SWEEP_ROUTE).toMatchObject({ name: 'ai.sweep', queue: 'ai' });
    expect(AI_SWEEP_ROUTE.cron.split(' ').slice(2)).toEqual(['*', '*', '*']);
    expect(AI_JOBS).toEqual([AI_SWEEP_ROUTE, ACCOUNTING_PULL_ROUTE]);
  });

  const setup = (sweepOrg?: OrgSweeper['sweepOrg']) => {
    const sweepFn = vi.fn<OrgSweeper['sweepOrg']>(
      sweepOrg ?? (async () => ({ projects: 3, removed: 0, restamped: 0 })),
    );
    const log = vi.fn<(msg: string, o: object) => void>();
    return { sweep: createSweep({ ai: { sweepOrg: sweepFn }, log }), sweepFn, log };
  };

  it("sweeps as the named system actor in the job's org, with no plan", async () => {
    const s = setup();
    await s.sweep({ job: 'ai.sweep', orgId: ORG });
    expect(s.sweepFn.mock.calls[0]![0]).toMatchObject({
      orgId: ORG,
      userId: AI_INDEX_ACTOR,
      principalType: 'member',
      orgRole: null,
      entitlements: { modules: [] },
    });
    expect(s.log).toHaveBeenCalledWith('ai sweep done', {
      orgId: ORG,
      projects: 3,
      removed: 0,
      restamped: 0,
    });
  });

  it('logs what it corrected, which is what the event path missed', async () => {
    const s = setup(async () => ({ projects: 2, removed: 7, restamped: 4 }));
    await s.sweep({ job: 'ai.sweep', orgId: ORG });
    expect(s.log).toHaveBeenCalledWith('ai sweep done', {
      orgId: ORG,
      projects: 2,
      removed: 7,
      restamped: 4,
    });
  });

  it('fails with the error code only', async () => {
    const s = setup(async () => {
      throw new Error('relation ai_chunks: key (text)=(CANARY-3310)');
    });
    const err = await s.sweep({ job: 'ai.sweep', orgId: ORG }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(`${err!.message}\n${err!.stack}`).not.toContain('CANARY');
    const coded = setup(async () => {
      throw new AppError('ai.unavailable');
    });
    await expect(coded.sweep({ job: 'ai.sweep', orgId: ORG })).rejects.toThrow(
      'ai job failed: ai.unavailable',
    );
  });
});

describe('failing at once when trying again cannot help', () => {
  it('stops retrying a request that is wrong, and still names only the code', () => {
    for (const code of [
      'document.not_found',
      'project.not_found',
      'validation_failed',
      'access.denied',
    ] as const) {
      const err = sanitizeFailure(new AppError(code, 'text of the record CANARY-5521'));
      expect(err, code).toBeInstanceOf(UnrecoverableError);
      expect(err.message).toBe(`ai job failed: ${code}`);
      expect(`${err.message}\n${err.stack}`).not.toContain('CANARY');
    }
  });

  it('keeps retrying what can change: provider and limit codes, "not now" statuses, server errors, anything else', () => {
    const retried = [
      new AppError('ai.unavailable'),
      new AppError('ai.allowance_used'),
      new AppError('rate_limited'),
      new AppError('conflict'),
      new AppError('version_conflict'),
      new AppError('internal'),
      new Error('connection reset'),
      'CANARY-5521',
    ];
    for (const err of retried) expect(sanitizeFailure(err)).not.toBeInstanceOf(UnrecoverableError);
  });
});

describe('the queue age report', () => {
  const NOW = 1_000_000_000;
  const fakeQueue = (
    over: Partial<AgeQueue> & { waiting?: number[]; delayed?: number[] } = {},
  ): AgeQueue => ({
    name: 'subscribers-ai',
    getJobCounts: async () => ({ waiting: 4, delayed: 1, active: 2 }),
    // Jobs of the one state asked for, in the order that state keeps them.
    getJobs: async (types) =>
      (types[0] === 'waiting' ? (over.waiting ?? [NOW - 90_000]) : (over.delayed ?? [])).map(
        (timestamp) => ({ timestamp }),
      ),
    ...over,
  });

  it('reports counts and the age of the oldest job waiting or retrying', async () => {
    expect(await measureQueue(fakeQueue({ waiting: [NOW - 90_000] }), NOW)).toEqual({
      queue: 'subscribers-ai',
      waiting: 4,
      retrying: 1,
      active: 2,
      oldestMs: 90_000,
    });
  });

  it('takes the oldest job whichever state holds it, and wherever it sits in that state', async () => {
    const fresh = NOW - 1_000;
    const old = NOW - 20 * 60_000;
    const age = async (waiting: number[], delayed: number[]) =>
      (await measureQueue(fakeQueue({ waiting, delayed }), NOW)).oldestMs;
    // A fresh waiting job does not hide an old one waiting for its retry, nor the other way round.
    expect(await age([fresh], [old])).toBe(20 * 60_000);
    expect(await age([old], [fresh])).toBe(20 * 60_000);
    // A retry promoted from the delayed set sits behind newer jobs with its first timestamp.
    expect(await age([fresh, fresh - 5, old], [])).toBe(20 * 60_000);
    expect(await age([], [fresh, old])).toBe(20 * 60_000);
  });

  it('says zero for an empty queue', async () => {
    const q = fakeQueue({ getJobCounts: async () => ({}), waiting: [] });
    expect(await measureQueue(q, NOW)).toMatchObject({ waiting: 0, retrying: 0, oldestMs: 0 });
  });

  it('logs at info while it keeps up and at warn past five minutes, and survives a failed read', async () => {
    vi.useFakeTimers();
    try {
      const log = { info: vi.fn(), warn: vi.fn() };
      let now = NOW;
      let stamps = [NOW - 1_000];
      let failing = false;
      const q = fakeQueue({
        getJobs: async () => {
          if (failing) throw new Error('redis down: CANARY-9');
          return stamps.map((timestamp) => ({ timestamp }));
        },
      });
      const stop = watchQueueAge(q, log, { everyMs: 60_000, now: () => now });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ oldestMs: 1_000 }),
        'ai queue age',
      );
      expect(log.warn).not.toHaveBeenCalled();

      stamps = [NOW - LAG_ALERT_MS - 1];
      await vi.advanceTimersByTimeAsync(60_000);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'subscribers-ai' }),
        'ai queue is behind',
      );

      failing = true;
      now += 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      const unreadable = log.warn.mock.calls.at(-1)!;
      expect(unreadable[1]).toBe('ai queue age unreadable');
      expect(JSON.stringify(unreadable)).not.toContain('CANARY');

      stop();
      const calls = log.info.mock.calls.length + log.warn.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(log.info.mock.calls.length + log.warn.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});
