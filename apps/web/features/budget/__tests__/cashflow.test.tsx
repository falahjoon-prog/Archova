// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import { chartScale, shortMonth } from '../lib/cashflow';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { CashflowPanel } = await import('../components/CashflowPanel');
const P = '/v1/orgs/{orgId}/projects/{projectId}';

const month = (m: string, kind: string, i: string, o: string, cum: string) => ({
  month: m,
  kind,
  cashIn: i,
  cashOut: o,
  net: (Number(i) - Number(o)).toFixed(2),
  cumulative: cum,
});

const data = {
  asOf: '2026-11-18',
  months: [
    month('2026-10', 'actual', '1000.00', '400.00', '600.00'),
    month('2026-11', 'current', '0.00', '900.00', '-300.00'),
    month('2026-12', 'forecast', '500.00', '0.00', '200.00'),
  ],
  totals: {
    cashInToDate: '1000.00',
    cashOutToDate: '400.00',
    forecastCashIn: '500.00',
    forecastCashOut: '900.00',
    lowestCumulative: '-300.00',
    lowestMonth: '2026-11',
  },
  wip: {
    contractValue: '10000.00',
    estimatedFinalCost: '8000.00',
    costToDate: '4000.00',
    percentComplete: '50.00',
    earnedRevenue: '5000.00',
    billed: '3000.00',
    overUnderBilled: '-2000.00',
    earnedGrossProfit: '1000.00',
    projectedGrossProfit: '2000.00',
    receivableOpen: '500.00',
    retentionHeld: '150.00',
  },
  flags: [
    {
      code: 'underbilled',
      severity: 'risk',
      title: 'Underbilled by $2,000',
      detail: 'Claim the difference.',
      month: null,
      amount: '2000.00',
    },
  ],
};

describe('chartScale', () => {
  it('spans the bars and the running line, and always includes zero', () => {
    const s = chartScale(data.months as never);
    expect(s.hi).toBe(100_000);
    expect(s.lo).toBe(-30_000);
  });
  it('labels a month for an axis', () => {
    expect(shortMonth('2026-11')).toBe('Nov 26');
  });
});

describe('CashflowPanel', () => {
  beforeEach(() => {
    fake.reset();
    fake.on('GET', `${P}/cashflow`, () => data);
  });

  it('shows the flag, the WIP position and the month table', async () => {
    renderInProject(<CashflowPanel />);
    expect(await screen.findByText('Underbilled by $2,000')).toBeTruthy();
    expect(screen.getByText('Claim the difference.')).toBeTruthy();
    expect(screen.getByText('50.00%')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /Cash in, cash out and running position/ }),
    ).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Cashflow by month' })).toBeTruthy();
    expect(screen.getAllByText('Nov 2026').length).toBeGreaterThan(0);
  });

  it('says so when there is nothing to show yet', async () => {
    fake.on('GET', `${P}/cashflow`, () => ({
      ...data,
      months: [month('2026-11', 'current', '0.00', '0.00', '0.00')],
      wip: null,
      flags: [],
    }));
    renderInProject(<CashflowPanel />);
    expect(await screen.findByText('No cash movements yet')).toBeTruthy();
    expect(screen.getByText(/Nothing to flag/)).toBeTruthy();
  });
});
