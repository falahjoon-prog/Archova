import { describe, expect, it } from 'vitest';
import { trustPosition, trustRequirement, trustTotals } from '../../src/domain/trust';

const req = (sopaState: string, dollars: number, governmentClient = false) =>
  trustRequirement({ sopaState, valueCents: dollars * 100, governmentClient });

describe('trustRequirement', () => {
  it('applies the QLD thresholds by client type', () => {
    expect(req('QLD', 1_000_000, true).required).toBe(true);
    expect(req('QLD', 999_999, true).required).toBe(false);
    expect(req('QLD', 10_000_000).required).toBe(true);
    expect(req('QLD', 9_999_999).required).toBe(false);
    expect(req('QLD', 5_000_000).required).toBe(false);
  });
  it('applies WA from $20,000 and NSW from $20 million', () => {
    expect(req('WA', 20_000).required).toBe(true);
    expect(req('WA', 19_999).required).toBe(false);
    expect(req('NSW', 20_000_000).required).toBe(true);
    expect(req('NSW', 19_999_999).required).toBe(false);
  });
  it('has no scheme elsewhere, and never claims the rules were reviewed', () => {
    expect(req('VIC', 90_000_000).required).toBe(false);
    expect(req('WA', 50_000).rulesReviewed).toBe(false);
  });
});

describe('trustTotals and trustPosition', () => {
  const m = (
    id: string,
    kind: 'deposit' | 'interest' | 'release' | 'reversal',
    amountCents: number,
    reversesMovementId: string | null = null,
  ) => ({ id, kind, amountCents, reversesMovementId });

  it('counts a reversal against the kind it undoes', () => {
    const t = trustTotals([
      m('a', 'deposit', 100_00),
      m('b', 'interest', 2_00),
      m('c', 'release', -30_00),
      m('d', 'reversal', 30_00, 'c'),
    ]);
    expect(t).toEqual({
      balanceCents: 102_00,
      depositedCents: 100_00,
      interestCents: 2_00,
      releasedCents: 0,
    });
  });

  it('reports not set up, shortfall and ok', () => {
    const base = { required: true, retentionWithheldCents: 50_00 };
    const none = trustTotals([]);
    expect(trustPosition({ ...base, setUp: false, totals: none }).status).toBe('not_set_up');
    const short = trustPosition({ ...base, setUp: true, totals: none });
    expect(short).toMatchObject({ status: 'shortfall', shortfallCents: 50_00 });
    const held = trustTotals([m('a', 'deposit', 50_00)]);
    expect(trustPosition({ ...base, setUp: true, totals: held }).status).toBe('ok');
    // Released retention is no longer owed to the trust.
    const paidOut = trustTotals([m('a', 'deposit', 50_00), m('b', 'release', -20_00)]);
    expect(trustPosition({ ...base, setUp: true, totals: paidOut })).toMatchObject({
      requiredInTrustCents: 30_00,
      shortfallCents: 0,
      status: 'ok',
    });
    expect(
      trustPosition({ required: false, setUp: false, retentionWithheldCents: 50_00, totals: none })
        .status,
    ).toBe('not_required');
  });
});
