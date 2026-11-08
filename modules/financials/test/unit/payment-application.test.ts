import { describe, expect, it } from 'vitest';
import {
  buildPaymentApplication,
  certifiedAmountFinding,
  type PaymentApplicationInput,
} from '../../src/domain/payment-application';
import {
  DEFAULT_PDF_OPTIONS,
  renderPaymentApplicationPdf,
} from '../../src/domain/payment-application-pdf';

const items = new Map([
  ['s1', { code: '01', description: 'Preliminaries', value: '40000.00', kind: 'sov' as const }],
  ['s2', { code: '02', description: 'Rough-in', value: '60000.00', kind: 'sov' as const }],
]);

function input(over: Partial<PaymentApplicationInput> = {}): PaymentApplicationInput {
  return {
    contract: {
      number: 1,
      title: 'Electrical',
      retentionPct: '5.00',
      retentionCapPct: null,
      originalValue: '100000.00',
    },
    items,
    approvedVariations: [],
    claim: {
      id: 'c2',
      number: 2,
      periodEnd: '2026-10-31',
      receivedAt: new Date('2026-11-01T01:00:00Z'),
      status: 'submitted',
      claimedGross: '30000.00',
      lessPrevious: '10000.00',
      retention: '1000.00',
      claimedNet: '19000.00',
      gst: '1900.00',
      claimedTotal: '20900.00',
      paymentDueOn: '2026-11-30',
      scheduleDueOn: '2026-11-15',
      scheduledAmount: null,
      paid: '0.00',
    },
    lines: [
      {
        sovItemId: 's1',
        variationId: null,
        previous: '10000.00',
        thisClaim: '10000.00',
        toDate: '20000.00',
      },
      {
        sovItemId: 's2',
        variationId: null,
        previous: '0.00',
        thisClaim: '10000.00',
        toDate: '10000.00',
      },
    ],
    prior: {
      number: 1,
      periodEnd: '2026-09-30',
      claimedGross: '10000.00',
      lessPrevious: '0.00',
      lines: [{ sovItemId: 's1', variationId: null, toDate: '10000.00' }],
    },
    today: '2026-11-07',
    ...over,
  };
}

describe('buildPaymentApplication', () => {
  it('breaks the claim down by item and totals it', () => {
    const a = buildPaymentApplication(input());
    expect(a.periodStart).toBe('2026-10-01');
    expect(a.summary).toMatchObject({
      revisedSum: '100000.00',
      completedToDate: '30000.00',
      percentComplete: '30.00',
      balanceToFinish: '70000.00',
      thisPeriod: '20000.00',
      currentPaymentDue: '20900.00',
    });
    expect(a.rows.map((r) => [r.code, r.percentComplete, r.balanceToFinish])).toEqual([
      ['01', '50.00', '20000.00'],
      ['02', '16.67', '50000.00'],
    ]);
  });

  it('finds nothing wrong with a consistent claim that steps up modestly', () => {
    // This period (20,000) is 2x the last (10,000) but is 20 points: that is the flagged jump, so use a smaller step.
    const a = buildPaymentApplication(
      input({
        claim: {
          ...input().claim,
          claimedGross: '25000.00',
          lessPrevious: '10000.00',
          retention: '750.00',
          claimedNet: '14250.00',
          gst: '1425.00',
          claimedTotal: '15675.00',
        },
        lines: [
          {
            sovItemId: 's1',
            variationId: null,
            previous: '10000.00',
            thisClaim: '5000.00',
            toDate: '15000.00',
          },
          {
            sovItemId: 's2',
            variationId: null,
            previous: '0.00',
            thisClaim: '10000.00',
            toDate: '10000.00',
          },
        ],
      }),
    );
    expect(a.findings).toEqual([]);
  });

  it('flags a large jump on the last period', () => {
    const a = buildPaymentApplication(input());
    expect(a.findings.map((f) => f.code)).toContain('jump.vs_prior_period');
  });

  it('flags lines that do not add up to the claim and over-100% items', () => {
    const a = buildPaymentApplication(
      input({
        lines: [
          {
            sovItemId: 's1',
            variationId: null,
            previous: '10000.00',
            thisClaim: '40000.00',
            toDate: '50000.00',
          },
          {
            sovItemId: 's2',
            variationId: null,
            previous: '0.00',
            thisClaim: '10000.00',
            toDate: '10000.00',
          },
        ],
      }),
    );
    const codes = a.findings.map((f) => f.code);
    expect(codes).toContain('amounts.this_period_mismatch');
    expect(codes).toContain('percent.over_100');
    expect(a.findings[0]!.severity).toBe('error');
  });

  it('flags a previous amount that differs from the last claim and a backwards claim', () => {
    const a = buildPaymentApplication(
      input({
        prior: {
          ...input().prior!,
          claimedGross: '35000.00',
          lines: [{ sovItemId: 's1', variationId: null, toDate: '15000.00' }],
        },
      }),
    );
    const codes = a.findings.map((f) => f.code);
    expect(codes).toContain('percent.previous_differs');
    expect(codes).toContain('percent.went_backwards');
  });

  it('checks dates', () => {
    const a = buildPaymentApplication(
      input({
        today: '2026-10-20',
        claim: { ...input().claim, periodEnd: '2026-09-30', paymentDueOn: '2026-09-01' },
      }),
    );
    const codes = a.findings.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining(['dates.period_not_after_prior', 'dates.payment_due_before_period']),
    );
  });

  it('flags retention that differs from the contract rate', () => {
    const a = buildPaymentApplication(
      input({
        claim: {
          ...input().claim,
          retention: '2000.00',
          claimedNet: '18000.00',
          gst: '1800.00',
          claimedTotal: '19800.00',
        },
      }),
    );
    expect(a.findings.map((f) => f.code)).toContain('amounts.retention_differs');
  });
});

describe('change orders and certificate', () => {
  it('splits approved variations into previous and this period', () => {
    const a = buildPaymentApplication(
      input({
        approvedVariations: [
          { amount: '5000.00', decidedOn: '2026-09-10' },
          { amount: '1000.00', decidedOn: '2026-09-12' },
          { amount: '2000.00', decidedOn: '2026-10-05' },
        ],
      }),
    );
    expect(a.changeOrders).toEqual({
      previousAdditions: '6000.00',
      previousDeductions: '0.00',
      thisAdditions: '2000.00',
      thisDeductions: '0.00',
      net: '8000.00',
    });
    expect(a.summary.revisedSum).toBe('108000.00');
  });

  it('flags an architect certified amount that differs from the amount applied for', () => {
    expect(certifiedAmountFinding('20900.00', '20900.00')).toBeNull();
    expect(certifiedAmountFinding('20900.00', '20000.00')?.message).toMatch(/900\.00 less/);
  });
});

describe('renderPaymentApplicationPdf', () => {
  it('renders a PDF, the same bytes every time, honouring the layout choices', async () => {
    const a = buildPaymentApplication(input());
    const one = await renderPaymentApplicationPdf(a, DEFAULT_PDF_OPTIONS, {
      commitmentTitle: 'Electrical',
    });
    const two = await renderPaymentApplicationPdf(a, DEFAULT_PDF_OPTIONS, {
      commitmentTitle: 'Electrical',
    });
    expect(Buffer.from(one).subarray(0, 5).toString()).toBe('%PDF-');
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
    const small = await renderPaymentApplicationPdf(
      a,
      {
        ...DEFAULT_PDF_OPTIONS,
        sections: ['summary'],
        notes: 'Emoji 🙂 is safe',
        signatureBlock: true,
        paper: 'letter',
        orientation: 'portrait',
      },
      { commitmentTitle: null },
    );
    expect(small.length).toBeLessThan(one.length);
  });

  it('continues onto more pages for a long schedule', async () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    const its = new Map(
      many.map((i) => [
        `s${i}`,
        {
          code: String(i),
          description: 'Item '.repeat(20),
          value: '1000.00',
          kind: 'sov' as const,
        },
      ]),
    );
    const a = buildPaymentApplication(
      input({
        items: its,
        lines: many.map((i) => ({
          sovItemId: `s${i}`,
          variationId: null,
          previous: '0.00',
          thisClaim: '100.00',
          toDate: '100.00',
        })),
        prior: null,
        claim: { ...input().claim, claimedGross: '12000.00', lessPrevious: '0.00' },
      }),
    );
    const bytes = await renderPaymentApplicationPdf(a, DEFAULT_PDF_OPTIONS, {
      commitmentTitle: null,
    });
    expect(
      Buffer.from(bytes)
        .toString('latin1')
        .match(/\/Type \/Page\b/g)!.length,
    ).toBeGreaterThan(2);
  });
});
