import { describe, expect, it } from 'vitest';
import type { Contract, PaymentClaim, Variation } from '../data/api';
import { agingVariations, rollupPrime, rollupSubcontracts } from '../lib/prime';

const v = (over: Partial<Variation>): Variation =>
  ({
    id: 'var_1',
    number: 1,
    title: 'V',
    amount: '1000.00',
    status: 'approved',
    submittedAt: null,
    ...over,
  }) as Variation;
const cl = (over: Partial<PaymentClaim>): PaymentClaim =>
  ({
    number: 1,
    isValid: true,
    status: 'submitted',
    claimedGross: '0.00',
    ...over,
  }) as PaymentClaim;

describe('rollupPrime', () => {
  it('adds approved variations, ignores others, and uses the latest valid cumulative claim', () => {
    const r = rollupPrime(
      { originalValue: '100000.00' },
      [
        v({ amount: '5000.00' }),
        v({ status: 'submitted', amount: '2000.00' }),
        v({ status: 'rejected', amount: '9000.00' }),
      ],
      [
        cl({ number: 1, claimedGross: '20000.00' }),
        cl({ number: 2, claimedGross: '42000.00' }),
        cl({ number: 3, claimedGross: '99000.00', isValid: false }),
        cl({ number: 4, claimedGross: '99000.00', status: 'withdrawn' }),
      ],
    );
    expect(r.revised).toBe(10_500_000);
    expect(r.pendingVariations).toBe(200_000);
    expect(r.pendingCount).toBe(1);
    expect(r.claimedToDate).toBe(4_200_000);
    expect(r.remainingToClaim).toBe(6_300_000);
    expect(r.percentClaimed).toBe(40);
  });
});

describe('agingVariations', () => {
  it('flags submitted variations at or past the threshold, oldest first', () => {
    const rows = [
      v({ id: 'a', status: 'submitted', submittedAt: '2026-10-20T02:00:00Z' }),
      v({ id: 'b', status: 'submitted', submittedAt: '2026-10-01T02:00:00Z' }),
      v({ id: 'c', status: 'submitted', submittedAt: '2026-11-05T02:00:00Z' }),
      v({ id: 'd', status: 'approved', submittedAt: '2026-09-01T02:00:00Z' }),
    ];
    const out = agingVariations(rows, '2026-11-07', 'Australia/Sydney');
    expect(out.map((x) => x.variation.id)).toEqual(['b', 'a']);
    expect(out[1]?.days).toBe(18);
  });
});

describe('rollupSubcontracts', () => {
  it('sums subcontracts only and shows what the builder keeps', () => {
    const cs = [
      { kind: 'head', originalValue: '100000.00' },
      { kind: 'subcontract', originalValue: '60000.00' },
      { kind: 'subcontract', originalValue: '15000.00' },
    ] as Contract[];
    const r = rollupSubcontracts(cs, 10_000_000);
    expect(r).toEqual({ count: 2, committed: 7_500_000, retained: 2_500_000, marginPct: 25 });
  });
});
