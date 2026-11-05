import { describe, expect, it } from 'vitest';
import {
  assessClaim,
  assessProject,
  deadlineState,
  insuranceState,
  orderRisks,
  type ClaimInput,
  type InsuranceInput,
} from '../../src/domain/risk';

const TODAY = '2026-11-05';

const claim = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  claimId: 'c1',
  claimNumber: 3,
  contractNumber: 2,
  contractTitle: 'Electrical',
  subbieName: 'Sparky Pty Ltd',
  scheduleDueOn: '2026-11-07',
  paymentDueOn: '2026-11-20',
  claimedTotalCents: 1_234_500,
  ...over,
});

const ins = (expiresOn: string | null, expiry: string): InsuranceInput => ({
  unseen: false,
  docs: [{ title: 'Public liability', expiresOn, expiry }],
});

const slip = (lateCount: number) => ({ restricted: false, hasProgramme: true, lateCount });

describe('deadlineState', () => {
  it('flags overdue, due soon, and ignores later deadlines', () => {
    expect(deadlineState('2026-11-04', TODAY)).toBe('overdue');
    expect(deadlineState('2026-11-05', TODAY)).toBe('due_soon');
    expect(deadlineState('2026-11-10', TODAY)).toBe('due_soon');
    expect(deadlineState('2026-11-11', TODAY)).toBeNull();
  });
});

describe('insuranceState', () => {
  it('is not_visible without a wallet read', () => {
    expect(insuranceState(undefined, null)).toBe('not_visible');
    expect(insuranceState({ unseen: true, docs: [] }, null)).toBe('not_visible');
  });
  it('separates none on file, expired, expiring before payment, and current', () => {
    expect(insuranceState({ unseen: false, docs: [] }, null)).toBe('none_on_file');
    expect(insuranceState(ins('2026-10-01', 'expired'), '2026-11-20')).toBe('expired');
    expect(insuranceState(ins('2026-11-15', 'expiring'), '2026-11-20')).toBe(
      'expires_before_payment_due',
    );
    expect(insuranceState(ins('2027-06-30', 'current'), '2026-11-20')).toBe('current');
    expect(insuranceState(ins(null, 'no_expiry'), '2026-11-20')).toBe('current');
  });
});

describe('assessClaim', () => {
  it('skips claims that are not near their deadline', () => {
    expect(assessClaim(claim({ scheduleDueOn: '2026-12-01' }), TODAY, undefined)).toBeNull();
  });
  it('writes the sentence from fixed templates', () => {
    const r = assessClaim(claim(), TODAY, ins('2026-10-01', 'expired'))!;
    expect(r.summary).toBe(
      'Claim 3 from Sparky Pty Ltd ($12,345.00): its payment schedule is due in 2 days (2026-11-07). Sparky Pty Ltd has an insurance on file that has expired.',
    );
    const o = assessClaim(
      claim({ scheduleDueOn: '2026-11-04' }),
      TODAY,
      ins('2027-01-01', 'current'),
    )!;
    expect(o.deadline).toBe('overdue');
    expect(o.summary).toContain('was due 1 day ago');
    expect(o.summary).not.toContain('insurance');
  });
  it('never calls an unreadable insurance fine', () => {
    const r = assessClaim(claim(), TODAY, { unseen: true, docs: [] })!;
    expect(r.insurance).toBe('not_visible');
    expect(r.summary).toContain("can't be seen");
  });
});

describe('assessProject', () => {
  const near = (i: InsuranceInput, over: Partial<ClaimInput> = {}) =>
    assessClaim(claim(over), TODAY, i)!;

  it('is high with both an insurance problem and programme slip', () => {
    const r = assessProject([near(ins('2026-10-01', 'expired'))], slip(4), false)!;
    expect(r).toMatchObject({ level: 'high', insuranceProblem: true, scheduleSlip: true });
  });
  it('is medium with one aggravator', () => {
    expect(assessProject([near(ins('2026-10-01', 'expired'))], slip(0), false)!.level).toBe(
      'medium',
    );
    expect(assessProject([near(ins('2027-06-30', 'current'))], slip(2), false)!.level).toBe(
      'medium',
    );
  });
  it('is low with none, medium when a schedule is already overdue', () => {
    const ok = ins('2027-06-30', 'current');
    expect(assessProject([near(ok)], slip(0), false)!.level).toBe('low');
    expect(assessProject([near(ok, { scheduleDueOn: '2026-11-01' })], slip(0), false)!.level).toBe(
      'medium',
    );
  });
  it('lists what it could not read instead of treating it as fine', () => {
    const r = assessProject(
      [near({ unseen: true, docs: [] })],
      { restricted: true, hasProgramme: false, lateCount: 0 },
      false,
    )!;
    expect(r.level).toBe('low');
    expect(r.unknown).toEqual(['insurance', 'programme (no access)']);
    const none = assessProject(
      [near(ins('2027-06-30', 'current'))],
      { restricted: false, hasProgramme: false, lateCount: 0 },
      false,
    )!;
    expect(none.unknown).toEqual(['programme (none loaded)']);
  });
  it('lists nothing when claims are unreadable or there are none near', () => {
    expect(assessProject([near(ins(null, 'no_expiry'))], slip(9), true)).toBeNull();
    expect(assessProject([], slip(9), false)).toBeNull();
  });
});

describe('orderRisks', () => {
  it('orders by level, then nearest deadline, then name', () => {
    const c = (days: number) => [{ daysToScheduleDue: days }] as never;
    const rows = [
      { name: 'B', level: 'low' as const, claims: c(-3) },
      { name: 'C', level: 'high' as const, claims: c(4) },
      { name: 'A', level: 'high' as const, claims: c(1) },
      { name: 'D', level: 'medium' as const, claims: c(0) },
    ];
    expect(orderRisks(rows).map((r) => r.name)).toEqual(['A', 'C', 'D', 'B']);
  });
});
