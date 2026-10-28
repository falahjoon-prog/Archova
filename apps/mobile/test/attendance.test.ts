import { describe, expect, it, vi } from 'vitest';
import type { SignInResult } from '@archova/contracts';
import {
  groupByCompany,
  parseGateCode,
  progressLabel,
  signInAtGate,
  signInMessage,
} from '../features/attendance';

vi.mock('../features/attendance/screens/SiteSignInScreen', () => ({}));
vi.mock('../features/attendance/screens/RollCallScreen', () => ({}));

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
