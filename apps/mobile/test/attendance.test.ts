import { describe, expect, it, vi } from 'vitest';
import type { SignInResult } from '@archova/contracts';
import { parseGateCode, signInAtGate, signInMessage } from '../features/attendance';

vi.mock('../features/attendance/screens/SiteSignInScreen', () => ({}));

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
