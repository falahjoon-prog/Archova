import { describe, expect, it } from 'vitest';
import {
  addMonths,
  computeCashflow,
  type CashClaim,
  type CashflowInput,
  type HeadTerms,
} from '../../src/domain/cashflow';

const head = (o: Partial<HeadTerms> = {}): HeadTerms => ({
  revenueCents: 1_000_000_00,
  billedGrossCents: 0,
  retentionPct: 5,
  retentionCapPct: null,
  paymentDays: 30,
  retentionReleasedCents: 0,
  pcReleased: false,
  practicalCompletionOn: null,
  defectsPeriodDays: null,
  firstReleasePct: 50,
  ...o,
});
const claim = (o: Partial<CashClaim>): CashClaim => ({
  number: 1,
  status: 'paid',
  netCents: 100_00,
  retentionCents: 0,
  paidMonth: '2026-09',
  dueOn: null,
  periodEnd: '2026-08-31',
  ...o,
});
const base = (o: Partial<CashflowInput> = {}): CashflowInput => ({
  today: '2026-11-18',
  head: head(),
  headClaims: [],
  subClaims: [],
  directCosts: [],
  costPlan: [],
  unscheduledCostCents: 0,
  payLagMonths: 1,
  costToDateCents: 0,
  estimatedFinalCostCents: 800_000_00,
  ...o,
});
const codes = (r: ReturnType<typeof computeCashflow>) => r.flags.map((f) => f.code);

describe('addMonths', () => {
  it('rolls over the year both ways', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('computeCashflow', () => {
  it('puts paid claims, direct costs and a running total in their months', () => {
    const r = computeCashflow(
      base({
        headClaims: [claim({ netCents: 500_00, paidMonth: '2026-09' })],
        subClaims: [claim({ netCents: 200_00, paidMonth: '2026-10' })],
        directCosts: [{ month: '2026-10', cents: 50_00 }],
      }),
    );
    expect(
      r.months.map((m) => [m.month, m.kind, m.cashInCents, m.cashOutCents, m.cumulativeCents]),
    ).toEqual([
      ['2026-09', 'actual', 500_00, 0, 500_00],
      ['2026-10', 'actual', 0, 250_00, 250_00],
      ['2026-11', 'current', 0, 0, 250_00],
    ]);
    expect(r.totals.cashInToDateCents).toBe(500_00);
    expect(r.totals.cashOutToDateCents).toBe(250_00);
  });

  it('lands open claims on their due date, and overdue ones this month', () => {
    const r = computeCashflow(
      base({
        headClaims: [
          claim({ status: 'scheduled', netCents: 300_00, dueOn: '2026-12-10' }),
          claim({ number: 2, status: 'submitted', netCents: 100_00, dueOn: '2026-10-01' }),
        ],
      }),
    );
    const by = Object.fromEntries(r.months.map((m) => [m.month, m.cashInCents]));
    expect(by['2026-11']).toBe(100_00);
    expect(by['2026-12']).toBe(300_00);
    expect(codes(r)).toContain('overdue_receivable');
  });

  it('keeps disputed claims out of the forecast but flags them', () => {
    const r = computeCashflow(
      base({ headClaims: [claim({ status: 'disputed', netCents: 900_00, dueOn: '2026-12-01' })] }),
    );
    expect(r.totals.forecastCashInCents).toBe(0);
    expect(codes(r)).toContain('disputed_claims');
  });

  it('bills the unbilled balance along the cost plan, less retention, one payment term later', () => {
    const r = computeCashflow(
      base({
        head: head({ revenueCents: 1_000_00, retentionPct: 10 }),
        costPlan: [
          { month: '2026-11', cents: 100_00 },
          { month: '2026-12', cents: 300_00 },
        ],
      }),
    );
    const cin = Object.fromEntries(r.months.map((m) => [m.month, m.cashInCents]));
    // 250 gross in Nov, 750 in Dec; 10% held back; paid a month later.
    expect(cin['2026-12']).toBe(225_00);
    expect(cin['2027-01']).toBe(675_00);
  });

  it('stops taking retention at the cap', () => {
    const r = computeCashflow(
      base({
        head: head({ revenueCents: 1_000_00, retentionPct: 10, retentionCapPct: 5 }),
        costPlan: [{ month: '2026-11', cents: 1 }],
      }),
    );
    // 5% of 1000 = 50 retained in total, not 100.
    expect(r.wip?.retentionHeldCents).toBe(0);
    expect(r.months.find((m) => m.month === '2026-12')?.cashInCents).toBe(950_00);
  });

  it('releases retention at practical completion and the end of the defects period', () => {
    const r = computeCashflow(
      base({
        head: head({
          revenueCents: 1_000_00,
          billedGrossCents: 1_000_00,
          retentionPct: 10,
          practicalCompletionOn: '2027-02-15',
          defectsPeriodDays: 365,
        }),
        headClaims: [
          claim({ status: 'paid', netCents: 900_00, retentionCents: 100_00, paidMonth: '2026-10' }),
        ],
      }),
    );
    const cin = Object.fromEntries(r.months.map((m) => [m.month, m.cashInCents]));
    expect(cin['2027-02']).toBe(50_00);
    expect(cin['2028-02']).toBe(50_00);
  });

  it('flags retention with no release date', () => {
    const r = computeCashflow(
      base({
        head: head({ billedGrossCents: 1_000_00, revenueCents: 1_000_00 }),
        headClaims: [claim({ netCents: 950_00, retentionCents: 50_00 })],
      }),
    );
    expect(codes(r)).toContain('retention_no_date');
  });

  it('pays the cost plan after the subcontract lag and flags a cash gap', () => {
    const r = computeCashflow(
      base({
        head: head({ revenueCents: 100_00, billedGrossCents: 100_00 }),
        costPlan: [
          { month: '2026-12', cents: 500_00 },
          { month: '2027-01', cents: 500_00 },
        ],
        payLagMonths: 1,
        costToDateCents: 0,
      }),
    );
    expect(r.months.find((m) => m.month === '2027-01')?.cashOutCents).toBe(500_00);
    expect(r.totals.lowestCumulativeCents).toBe(-1_000_00);
    expect(r.totals.lowestMonth).toBe('2027-02');
    const gap = r.flags.find((f) => f.code === 'cash_gap');
    expect(gap?.severity).toBe('risk');
    expect(gap?.amountCents).toBe(1_000_00);
  });

  it('warns when there is no cost plan, and when part of it is unplaced', () => {
    expect(codes(computeCashflow(base()))).toContain('no_cost_plan');
    const r = computeCashflow(
      base({ costPlan: [{ month: '2026-12', cents: 10_00 }], unscheduledCostCents: 5_00 }),
    );
    expect(codes(r)).toContain('unscheduled_cost');
  });

  it('does not invent a head contract', () => {
    const r = computeCashflow(base({ head: null }));
    expect(r.wip).toBeNull();
    expect(codes(r)).toContain('no_head_contract');
  });
});

describe('WIP', () => {
  const wipOf = (billed: number, costToDate: number, est = 800_000_00) =>
    computeCashflow(
      base({
        head: head({ billedGrossCents: billed }),
        costToDateCents: costToDate,
        estimatedFinalCostCents: est,
      }),
    );

  it('earns revenue by cost to cost', () => {
    const w = wipOf(300_000_00, 400_000_00).wip!;
    expect(w.percentCompleteHundredths).toBe(5000);
    expect(w.earnedRevenueCents).toBe(500_000_00);
    expect(w.overUnderBilledCents).toBe(-200_000_00);
    expect(w.earnedGrossProfitCents).toBe(100_000_00);
    expect(w.projectedGrossProfitCents).toBe(200_000_00);
  });

  it('flags underbilling with the amount, as a risk once it is a tenth of the contract', () => {
    const f = wipOf(300_000_00, 400_000_00).flags.find((x) => x.code === 'underbilled')!;
    expect(f.amountCents).toBe(200_000_00);
    expect(f.severity).toBe('risk');
    expect(f.detail).toContain('$500,000');
  });

  it('flags overbilling', () => {
    const r = wipOf(700_000_00, 400_000_00);
    expect(r.wip!.overUnderBilledCents).toBe(200_000_00);
    expect(codes(r)).toContain('overbilled');
  });

  it('stays quiet when billing tracks the work', () => {
    const r = wipOf(500_000_00, 400_000_00);
    expect(codes(r)).not.toContain('underbilled');
    expect(codes(r)).not.toContain('overbilled');
  });

  it('never goes past 100 percent when cost passes the estimate, and flags a loss', () => {
    const r = wipOf(900_000_00, 1_100_000_00, 1_100_000_00);
    expect(r.wip!.percentCompleteHundredths).toBe(10_000);
    expect(r.wip!.earnedRevenueCents).toBe(1_000_000_00);
    expect(codes(r)).toContain('loss_making');
  });

  it('has no percent complete before any cost', () => {
    expect(wipOf(0, 0).wip!.percentCompleteHundredths).toBe(0);
  });
});
