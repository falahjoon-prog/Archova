import { describe, expect, it, vi } from 'vitest';
import type { SignInResult } from '@archova/contracts';
import type { RollCall } from '@archova/contracts';
import { migrate } from '../lib/db';
import type { QueuedAction } from '../lib/actions/action-queue';
import { RollCallCache } from '../lib/attendance/roll-call-cache';
import { nodeSqlDriver } from './support/node-sql';
import {
  applyQueued,
  findOpenRollCall,
  groupByCompany,
  parseGateCode,
  progressLabel,
  signInAtGate,
  signInMessage,
} from '../features/attendance';

vi.mock('../features/attendance/screens/SiteSignInScreen', () => ({}));
vi.mock('../features/attendance/screens/RollCallScreen', () => ({}));
vi.mock('../features/attendance/screens/SafetyBadgeScreen', () => ({}));

const result = (over: Partial<SignInResult>): SignInResult =>
  ({ outcome: 'accepted', eligibility: null, session: null, worker: {}, ...over }) as SignInResult;

describe('parseGateCode', () => {
  it('takes a bare token or a link carrying one', () => {
    expect(parseGateCode(' gqr_AbCdEfGhIjKlMnOp ')).toBe('gqr_AbCdEfGhIjKlMnOp');
    expect(parseGateCode('https://archova.com.au/g?c=gqr_AbCdEfGhIjKlMnOp&x=1')).toBe(
      'gqr_AbCdEfGhIjKlMnOp',
    );
  });

  it('rejects anything else', () => {
    expect(parseGateCode('https://example.com')).toBeNull();
    expect(parseGateCode('gqr_short')).toBeNull();
  });
});

describe('signInMessage', () => {
  it('welcomes an accepted sign-in', () => {
    expect(signInMessage(result({}))).toMatchObject({ tone: 'success', title: 'Signed in' });
  });

  it('tells a blocked worker to see the office and why (ATT-AC7)', () => {
    const m = signInMessage(
      result({
        outcome: 'blocked',
        eligibility: {
          result: 'blocked',
          reasons: [
            { code: 'induction.missing', blocking: true },
            { code: 'white_card.missing', blocking: true },
            { code: 'note', blocking: false },
          ],
        } as SignInResult['eligibility'],
      }),
    );
    expect(m).toEqual({
      tone: 'danger',
      title: 'See the site office before starting work',
      detail: 'Site induction not done. White card not on file',
    });
  });

  it('flags an override and a repeat scan as warnings', () => {
    expect(signInMessage(result({ outcome: 'overridden' })).tone).toBe('warning');
    expect(signInMessage(result({ outcome: 'already_on_site' })).tone).toBe('warning');
  });
});

describe('signInAtGate', () => {
  it('sends the code with an idempotency key and the scan time', async () => {
    const POST = vi.fn().mockResolvedValue({
      data: result({}),
      response: { ok: true, status: 200 },
    });
    const out = await signInAtGate(
      { POST } as never,
      { orgId: 'o1', projectId: 'p1' },
      { gateCode: 'gqr_AbCdEfGhIjKlMnOp', idempotencyKey: 'k1', clientAt: '2026-10-28T14:30:00Z' },
    );
    expect(out.outcome).toBe('accepted');
    expect(POST).toHaveBeenCalledWith('/v1/orgs/{orgId}/projects/{projectId}/attendance/sign-in', {
      params: { path: { orgId: 'o1', projectId: 'p1' }, header: { 'Idempotency-Key': 'k1' } },
      body: { gateCode: 'gqr_AbCdEfGhIjKlMnOp', clientAt: '2026-10-28T14:30:00Z' },
    });
  });
});

describe('roll call display', () => {
  const person = (over: Record<string, unknown>) =>
    ({ workerId: 'w', fullName: 'A', companyId: null, companyNameOther: null, ...over }) as never;

  it('groups consecutive people by company name', () => {
    const groups = groupByCompany(
      [
        person({ workerId: '1', companyId: 'c1' }),
        person({ workerId: '2', companyId: 'c1' }),
        person({ workerId: '3', companyNameOther: 'Visitors Pty' }),
        person({ workerId: '4' }),
      ],
      (id) => (id === 'c1' ? 'Acme Electrical' : undefined),
    );
    expect(groups.map((g) => [g.company, g.people.length])).toEqual([
      ['Acme Electrical', 2],
      ['Visitors Pty', 1],
      ['No company', 1],
    ]);
  });

  it('summarises progress and hides zero counts', () => {
    expect(progressLabel({ total: 42, accountedFor: 30, missing: 2, unmarked: 10 })).toBe(
      '30 of 42 accounted for · 2 missing · 10 to check',
    );
    expect(progressLabel({ total: 5, accountedFor: 5, missing: 0, unmarked: 0 })).toBe(
      '5 of 5 accounted for',
    );
  });
});

describe('findOpenRollCall', () => {
  const ok = (data: unknown[]) =>
    vi.fn().mockResolvedValue({ data: { data }, response: { ok: true, status: 200 } });

  it('asks for open roll calls and returns the newest', async () => {
    const GET = ok([{ id: 'rlc_new' }, { id: 'rlc_old' }]);
    const found = await findOpenRollCall({ GET } as never, { orgId: 'o', projectId: 'p' });
    expect(found).toEqual({ id: 'rlc_new' });
    expect(GET.mock.calls[0]![1].params.query).toEqual({ open: 'true' });
  });

  it('returns null when none is open', async () => {
    expect(
      await findOpenRollCall({ GET: ok([]) } as never, { orgId: 'o', projectId: 'p' }),
    ).toBeNull();
  });
});

const person = (id: string, status: RollCall['people'][number]['status'] = 'unmarked') =>
  ({
    workerId: id,
    fullName: id,
    phone: null,
    companyId: null,
    companyNameOther: null,
    siteId: null,
    signedInAt: null,
    status,
    markedAt: null,
    markedBy: null,
  }) as RollCall['people'][number];

const call = (people: RollCall['people']): RollCall =>
  ({
    id: 'rlc_1',
    projectId: 'prj_1',
    siteId: null,
    reason: 'Drill',
    startedAt: '2026-11-21T01:00:00.000Z',
    startedBy: null,
    endedAt: null,
    counts: { total: people.length, accountedFor: 0, missing: 0, unmarked: people.length },
    people,
  }) as RollCall;

const queued = (
  kind: QueuedAction['kind'],
  payload: Record<string, unknown>,
  over: Partial<QueuedAction> = {},
): QueuedAction => ({
  id: `a_${Math.random()}`,
  projectId: 'prj_1',
  kind,
  targetId: 'rlc_1',
  payload,
  state: 'pending',
  lastError: null,
  attempts: 0,
  createdAt: '2026-11-21T01:01:00.000Z',
  ...over,
});

describe('applyQueued (roll call with no signal)', () => {
  it('shows taps waiting to be sent, with the time they were made', () => {
    const rc = applyQueued(call([person('a'), person('b'), person('c')]), [
      queued('rollcall.mark', {
        workerId: 'a',
        status: 'accounted_for',
        at: '2026-11-21T01:02:00.000Z',
      }),
      queued('rollcall.mark', { workerId: 'b', status: 'missing', at: '2026-11-21T01:03:00.000Z' }),
    ]);
    expect(rc.counts).toEqual({ total: 3, accountedFor: 1, missing: 1, unmarked: 1 });
    expect(rc.people[0]).toMatchObject({
      status: 'accounted_for',
      markedAt: '2026-11-21T01:02:00.000Z',
    });
  });

  it('all clear ticks everyone left and ends it, unless someone is missing', () => {
    const at = '2026-11-21T01:05:00.000Z';
    const clear = applyQueued(call([person('a'), person('b', 'accounted_for')]), [
      queued('rollcall.allClear', { at }),
    ]);
    expect(clear.endedAt).toBe(at);
    expect(clear.counts).toMatchObject({ accountedFor: 2, unmarked: 0 });
    const blocked = applyQueued(call([person('a', 'missing'), person('b')]), [
      queued('rollcall.allClear', { at }),
    ]);
    expect(blocked.endedAt).toBeNull();
    expect(blocked.people.map((p) => p.status)).toEqual(['missing', 'unmarked']);
  });

  it('ignores refused taps and other roll calls, and returns the same object when nothing waits', () => {
    const base = call([person('a')]);
    expect(
      applyQueued(base, [
        queued('rollcall.mark', { workerId: 'a', status: 'missing' }, { state: 'refused' }),
        queued('rollcall.mark', { workerId: 'a', status: 'missing' }, { targetId: 'rlc_2' }),
      ]),
    ).toBe(base);
  });
});

describe('RollCallCache', () => {
  it('keeps the roll call in progress per project and replaces it', async () => {
    const db = await nodeSqlDriver().open('rollcall.db');
    await migrate(db);
    const cache = new RollCallCache(db);
    expect(await cache.get('prj_1')).toBeNull();
    await cache.put('prj_1', call([person('a')]));
    await cache.put('prj_1', call([person('a'), person('b')]));
    expect((await cache.get('prj_1'))!.people).toHaveLength(2);
    expect(await cache.get('prj_2')).toBeNull();
    await cache.clear('prj_1');
    expect(await cache.get('prj_1')).toBeNull();
  });
});
