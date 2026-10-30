import { describe, expect, it, vi } from 'vitest';
import { AppError, type Entitlements } from '@archova/kernel';
import { AI_INDEX_ACTOR } from '@archova/mod-ai';
import {
  createReindex,
  DEBOUNCE_MS,
  sanitizeFailure,
  type RecordIndexer,
  type ReindexJob,
} from '../../src/ai/reindex';
import type { StoredEvent } from '../../src/subscribers';

const ORG = '0192f0a0-0000-7000-8000-000000000001';
const PROJECT = '0192f0a0-0000-7000-8000-000000000002';
const RECORD = '0192f0a0-0000-7000-8000-000000000003';

const PLAN: Entitlements = { plan: 'team', state: 'active', modules: ['ai'], limits: {} };

const event = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: '0192f0a0-0000-7000-8000-0000000000e1',
  orgId: ORG,
  type: 'defects.defect.voided.v1',
  projectId: PROJECT,
  entityType: 'defect',
  entityId: RECORD,
  entityVersion: 2,
  actor: null,
  data: {},
  traceId: null,
  occurredAt: '2026-10-28T10:00:00.000Z',
  ...over,
});

function setup(
  opts: {
    isSource?: boolean;
    embed?: RecordIndexer['reindexRecord'];
    orgExists?: boolean;
    entitlements?: Entitlements;
    at?: string;
  } = {},
) {
  let clock = new Date(opts.at ?? '2026-10-28T10:00:10.000Z');
  const added: Array<{
    name: string;
    data: ReindexJob;
    jobId: string;
    delay: number;
    attempts: number;
  }> = [];
  const drop = vi.fn<RecordIndexer['dropStaleRecord']>(async () => ({
    isSource: opts.isSource ?? true,
  }));
  const embed = vi.fn<RecordIndexer['reindexRecord']>(
    opts.embed ?? (async () => ({ indexed: 1, unchanged: 0 })),
  );
  const entitlementsFor = vi.fn(async () => opts.entitlements ?? PLAN);
  const log = vi.fn<(msg: string, o: object) => void>();
  const reindex = createReindex({
    ai: { dropStaleRecord: drop, reindexRecord: embed },
    entitlementsFor,
    orgExists: async () => opts.orgExists ?? true,
    queue: {
      add: async (name, data, o) => {
        added.push({ name, data, jobId: o.jobId, delay: o.delay, attempts: o.attempts });
      },
    },
    log,
    now: () => clock,
  });
  return {
    ...reindex,
    drop,
    embed,
    entitlementsFor,
    log,
    added,
    setClock: (iso: string) => (clock = new Date(iso)),
  };
}
const handle = (r: ReturnType<typeof setup>, e: StoredEvent) =>
  r.subscriber.handle(e, { database: null as never });

describe('stage 1: the change event', () => {
  it("drops stale text as the named system actor, in the event's own org, before anything else", async () => {
    const r = setup();
    await handle(r, event());
    const [ctx, projectId, kind, recordId] = r.drop.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
      string,
      string,
    ];
    expect(ctx).toMatchObject({
      orgId: ORG,
      userId: AI_INDEX_ACTOR,
      principalType: 'member',
      orgRole: null,
    });
    expect([projectId, kind, recordId]).toEqual([PROJECT, 'defect', RECORD]);
    // Deleting asks nothing of the plan.
    expect((ctx.entitlements as Entitlements).modules).toEqual([]);
    expect(r.entitlementsFor).not.toHaveBeenCalled();
  });

  it('schedules no embedding for a record that is no longer a source', async () => {
    const r = setup({ isSource: false });
    await handle(r, event());
    expect(r.added).toEqual([]);
  });

  it('schedules one delayed embedding for a record that is still a source', async () => {
    const r = setup();
    await handle(r, event({ type: 'defects.defect.disputed.v1' }));
    expect(r.added).toHaveLength(1);
    expect(r.added[0]).toMatchObject({
      name: 'reindex-record',
      data: { orgId: ORG, projectId: PROJECT, kind: 'defect', recordId: RECORD },
    });
    expect(r.added[0]!.delay).toBeGreaterThanOrEqual(DEBOUNCE_MS);
  });

  it('gives a burst of edits in one window the same job id, and the next window its own', async () => {
    const r = setup({ at: '2026-10-28T10:00:05.000Z' });
    await handle(r, event({ id: 'e1' }));
    r.setClock('2026-10-28T10:00:40.000Z');
    await handle(r, event({ id: 'e2' }));
    expect(r.added[0]!.jobId).toBe(r.added[1]!.jobId);

    r.setClock('2026-10-28T10:01:10.000Z');
    await handle(r, event({ id: 'e3' }));
    expect(r.added[2]!.jobId).not.toBe(r.added[0]!.jobId);
    // Another record in the same window is not folded into it.
    await handle(r, event({ id: 'e4', entityId: '0192f0a0-0000-7000-8000-000000000009' }));
    expect(r.added[3]!.jobId).not.toBe(r.added[2]!.jobId);
  });

  it('never starts a job inside the window whose events it stands for', async () => {
    // The job for a window runs at least a whole window after the event that created it, so any later event with the
    // same job id (same window) is read by it, and one that arrives after it starts gets a new id.
    const r = setup({ at: '2026-10-28T10:00:59.999Z' });
    await handle(r, event());
    const first = r.added[0]!;
    const startsAt = new Date('2026-10-28T10:00:59.999Z').getTime() + first.delay;
    expect(Math.floor(startsAt / DEBOUNCE_MS)).toBeGreaterThan(
      Math.floor(new Date('2026-10-28T10:00:59.999Z').getTime() / DEBOUNCE_MS),
    );
  });

  it('ignores an event that is not about a record, or has no project', async () => {
    const r = setup();
    await handle(r, event({ type: 'files.object.created.v1' }));
    await handle(r, event({ projectId: null }));
    expect(r.drop).not.toHaveBeenCalled();
    expect(r.added).toEqual([]);
  });

  it.each([
    ['rfis.rfi.sent.v1', 'rfi'],
    ['defects.defect.issued.v1', 'defect'],
    ['diary.entry.submitted.v1', 'diary'],
  ])('reads %s as a %s', async (type, kind) => {
    const r = setup();
    await handle(r, event({ type }));
    expect(r.drop.mock.calls[0]![2]).toBe(kind);
  });
});

const job: ReindexJob = { orgId: ORG, projectId: PROJECT, kind: 'defect', recordId: RECORD };

describe('stage 2: the embedding job', () => {
  it("embeds as the system actor under the org's own plan", async () => {
    const r = setup();
    await r.reindex(job);
    const [ctx, projectId, kind, recordId] = r.embed.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
      string,
      string,
    ];
    expect(ctx).toMatchObject({
      orgId: ORG,
      userId: AI_INDEX_ACTOR,
      orgRole: null,
      entitlements: PLAN,
    });
    expect([projectId, kind, recordId]).toEqual([PROJECT, 'defect', RECORD]);
  });

  it('skips a deleted org without asking for its plan or embedding anything', async () => {
    const r = setup({ orgExists: false });
    await r.reindex(job);
    expect(r.entitlementsFor).not.toHaveBeenCalled();
    expect(r.embed).not.toHaveBeenCalled();
    expect(r.log).toHaveBeenCalledWith(
      'ai re-index skipped',
      expect.objectContaining({ reason: 'org_deleted' }),
    );
  });

  it.each(['read_only', 'cancelled'] as const)('skips an org whose plan is %s', async (state) => {
    const r = setup({ entitlements: { ...PLAN, state } });
    await r.reindex(job);
    expect(r.embed).not.toHaveBeenCalled();
  });

  it.each(['entitlement-required', 'ai.disabled', 'ai.feature_disabled'] as const)(
    'ends quietly when Nova says %s, so the job is not retried',
    async (code) => {
      const r = setup({
        embed: async () => {
          throw new AppError(code);
        },
      });
      await expect(r.reindex(job)).resolves.toBeUndefined();
      expect(r.log).toHaveBeenCalledWith(
        'ai re-index skipped',
        expect.objectContaining({ reason: code }),
      );
    },
  );

  describe('when the org has used its daily embedding cap', () => {
    // Midnight in Sydney (+11 in October), as the gateway reports it.
    const RESETS_AT = '2026-10-28T13:00:00.000Z';
    const limited = (extra: Record<string, unknown> = { resetsAt: RESETS_AT }) =>
      new AppError('ai.embedding_limit', 'Used up for today.', undefined, extra);
    const resetMs = new Date(RESETS_AT).getTime();
    const nowMs = new Date('2026-10-28T10:00:10.000Z').getTime();

    it('ends the job and embeds the record after the reset, not an hour of retries against the cap', async () => {
      const r = setup({
        embed: async () => {
          throw limited();
        },
      });
      await expect(r.reindex(job)).resolves.toBeUndefined();
      expect(r.added).toHaveLength(1);
      const [next] = r.added;
      expect(next).toMatchObject({ name: 'reindex-record', data: job, attempts: 20 });
      expect(next!.jobId).toBe(`${ORG}.defect.${RECORD}.after.${resetMs}`);
      // Never before the reset, and within the spread after it.
      expect(nowMs + next!.delay).toBeGreaterThanOrEqual(resetMs + 2_000);
      expect(nowMs + next!.delay).toBeLessThan(resetMs + 2_000 + 15 * 60_000);
      expect(r.log).toHaveBeenCalledWith(
        'ai re-index deferred',
        expect.objectContaining({ recordId: RECORD, resetsAt: RESETS_AT }),
      );
    });

    it('defers a record once per reset however many jobs meet the cap, and spreads different records', async () => {
      const r = setup({
        embed: async () => {
          throw limited();
        },
      });
      await r.reindex(job);
      await r.reindex(job);
      expect(r.added[0]!.jobId).toBe(r.added[1]!.jobId);
      expect(r.added[0]!.delay).toBe(r.added[1]!.delay);

      const others = [
        '0192f0a0-0000-7000-8000-00000000000a',
        '0192f0a0-0000-7000-8000-00000000000b',
      ];
      for (const recordId of others) await r.reindex({ ...job, recordId });
      expect(new Set(r.added.map((a) => a.jobId)).size).toBe(3);
      expect(new Set(r.added.map((a) => a.delay)).size).toBeGreaterThan(1);
    });

    it('a reset in the past still waits a moment before the job starts', async () => {
      const r = setup({
        embed: async () => {
          throw limited({ resetsAt: '2026-10-28T09:00:00.000Z' });
        },
      });
      await r.reindex(job);
      expect(r.added[0]!.delay).toBeGreaterThanOrEqual(2_000);
    });

    it.each([{}, { resetsAt: 'tomorrow' }, { resetsAt: 42 }])(
      'retries as usual when the reset time is unusable (%j), since there is nowhere to defer to',
      async (extra) => {
        const r = setup({
          embed: async () => {
            throw limited(extra);
          },
        });
        await expect(r.reindex(job)).rejects.toThrow('ai job failed: ai.embedding_limit');
        expect(r.added).toEqual([]);
      },
    );
  });

  it('rethrows anything else so BullMQ retries it, naming the error code and nothing more', async () => {
    const r = setup({
      embed: async () => {
        throw new AppError('ai.unavailable');
      },
    });
    await expect(r.reindex(job)).rejects.toThrow('ai job failed: ai.unavailable');
  });

  it('keeps record text out of a failed job: BullMQ stores the reason and stack for 14 days', async () => {
    const text = 'Grout is missing at the waste. CANARY-7741';
    const r = setup({
      embed: async () => {
        throw new Error(`provider rejected input: ${text}`);
      },
    });
    const err = await r.reindex(job).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('ai job failed: Error');
    expect(`${err!.message}\n${err!.stack}`).not.toContain('CANARY');
    expect(err).not.toHaveProperty('cause');
  });

  it('keeps record text out of a failed drop too, and a thrown non-error is named unknown', async () => {
    const r = setup();
    r.drop.mockRejectedValueOnce(new Error('relation ai_chunks: key (text)=(CANARY-7741)'));
    const err = await handle(r, event()).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(`${err!.message}\n${err!.stack}`).not.toContain('CANARY');
    expect(err!.message).toBe('ai job failed: Error');

    expect(sanitizeFailure('CANARY-7741').message).toBe('ai job failed: unknown');
  });

  it('logs ids and counts only', async () => {
    const r = setup();
    await r.reindex(job);
    const logged = JSON.stringify(r.log.mock.calls);
    expect(logged).toContain(RECORD);
    expect(logged).toContain('"indexed":1');
  });
});
