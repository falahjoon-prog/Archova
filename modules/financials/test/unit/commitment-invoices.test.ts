import { describe, expect, it } from 'vitest';
import { percentString, summariseInvoices } from '../../src/domain/commitment-invoices';

const claim = (n: number, over: Record<string, unknown> = {}) => ({
  id: `c${n}`,
  number: n,
  periodEnd: n === 1 ? '2026-10-31' : '2026-11-30',
  receivedAt: new Date('2026-11-01T00:00:00Z'),
  status: 'submitted',
  claimedGross: '10000.00',
  lessPrevious: '0.00',
  retention: '500.00',
  claimedNet: '9500.00',
  scheduledAmount: null as string | null,
  paid: '0.00',
  paymentDueOn: null as string | null,
  ...over,
});

describe('summariseInvoices', () => {
  it('rolls the contract sum, retainage, payments and percentages up', () => {
    const s = summariseInvoices({
      originalValue: '90000.00',
      approvedVariations: ['10000.00'],
      claims: [
        claim(1, { paid: '9500.00' }),
        claim(2, {
          claimedGross: '30000.00',
          lessPrevious: '10000.00',
          retention: '1000.00',
          claimedNet: '19000.00',
          scheduledAmount: '18000.00',
          paid: '5000.00',
        }),
      ],
    });
    expect(s.revisedSum).toBe('100000.00');
    expect(s.netChange).toBe('10000.00');
    expect(s.invoiced).toBe('30000.00');
    expect(s.retainage).toBe('1500.00');
    expect(s.paid).toBe('14500.00');
    expect(s.remaining).toBe('13000.00'); // (9500 + 18000) - 14500
    expect(s.percentPaid).toBe('52.73');
    const [a, b] = s.rows;
    expect(a!.periodStart).toBeNull();
    expect(b!.periodStart).toBe('2026-11-01');
    expect(b!.thisPeriod).toBe('20000.00');
    expect(b!.paymentDue).toBe('13000.00');
    expect(b!.percentComplete).toBe('30.00');
    expect(b!.balanceToFinish).toBe('70000.00');
  });

  it('lists a withdrawn claim without counting it', () => {
    const s = summariseInvoices({
      originalValue: '1000.00',
      approvedVariations: [],
      claims: [claim(1, { status: 'withdrawn', paid: '0.00' })],
    });
    expect(s.rows).toHaveLength(1);
    expect(s.invoiced).toBe('0.00');
    expect(s.retainage).toBe('0.00');
    expect(s.percentPaid).toBe('0.00');
  });

  it('reports a negative balance when a claim passes the contract sum', () => {
    const s = summariseInvoices({
      originalValue: '1000.00',
      approvedVariations: [],
      claims: [claim(1, { claimedGross: '1200.00', retention: '0.00', claimedNet: '1200.00' })],
    });
    expect(s.rows[0]!.balanceToFinish).toBe('-200.00');
  });
});

describe('percentString', () => {
  it('is zero over zero', () => expect(percentString(5, 0)).toBe('0.00'));
});
