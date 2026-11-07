// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import { gridRows } from '../lib/applicationGrid';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { InvoiceDetailScreen } = await import('../screens/InvoiceDetailScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}/commitments/{commitmentId}/invoices/{claimId}';
const rows = [
  {
    key: 'a',
    code: '01',
    description: 'Prelims',
    kind: 'sov',
    costCode: '5003',
    scheduledValue: '40000.00',
    previous: '10000.00',
    thisPeriod: '10000.00',
    completedToDate: '20000.00',
    percentComplete: '50.00',
    balanceToFinish: '20000.00',
  },
  {
    key: 'b',
    code: '02',
    description: 'Rough-in',
    kind: 'sov',
    costCode: null,
    scheduledValue: '60000.00',
    previous: '0.00',
    thisPeriod: '10000.00',
    completedToDate: '10000.00',
    percentComplete: '16.67',
    balanceToFinish: '50000.00',
  },
];
const app = (findings: unknown[]) => ({
  claimId: 'pcl_1',
  commitmentTitle: 'Electrical',
  contractNumber: 1,
  contractTitle: 'Electrical contract',
  claimNumber: 2,
  status: 'submitted',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  receivedAt: '2026-11-01T00:00:00.000Z',
  paymentDueOn: null,
  scheduleDueOn: null,
  summary: {
    originalSum: '100000.00',
    netChange: '0.00',
    revisedSum: '100000.00',
    completedToDate: '30000.00',
    retainage: '1000.00',
    earnedLessRetainage: '19000.00',
    lessPrevious: '10000.00',
    thisPeriod: '20000.00',
    gst: '1900.00',
    currentPaymentDue: '20900.00',
    scheduledAmount: null,
    paid: '0.00',
    balanceToFinish: '70000.00',
    percentComplete: '30.00',
  },
  changeOrders: {
    previousAdditions: '0.00',
    previousDeductions: '0.00',
    thisAdditions: '0.00',
    thisDeductions: '0.00',
    net: '0.00',
  },
  retentionPct: '5.00',
  rows,
  prior: null,
  findings,
});

beforeEach(() => fake.reset());

describe('gridRows', () => {
  it('works out total, % and balance from the entered columns, and totals them', () => {
    const g = gridRows(rows as never);
    expect(g.rows[0]).toMatchObject({
      itemNo: 1,
      costCode: '5003',
      completedAndStored: '20000.00',
      percent: '50.00',
      balance: '20000.00',
    });
    expect(g.rows[1]!.costCode).toBe('02');
    expect(g.total).toMatchObject({
      scheduledValue: '100000.00',
      thisPeriod: '20000.00',
      completedAndStored: '30000.00',
      percent: '30.00',
      balance: '70000.00',
    });
  });
});

describe('InvoiceDetailScreen', () => {
  it('shows the line items grid with a total row', async () => {
    fake.on('GET', P, () => app([]));
    renderInProject(<InvoiceDetailScreen commitmentId="cmt_1" claimId="pcl_1" />);
    expect(await screen.findByText('Prelims')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('30.00%')).toBeTruthy();
  });

  it('lists findings and holds the PDF until they are acknowledged', async () => {
    fake.on('GET', P, () =>
      app([
        { code: 'jump.vs_prior_period', severity: 'warning', message: 'Big jump', itemCode: null },
      ]),
    );
    renderInProject(<InvoiceDetailScreen commitmentId="cmt_1" claimId="pcl_1" />);
    fireEvent.click(await screen.findByRole('tab', { name: /Summary preview/ }));
    expect(await screen.findByText('Big jump')).toBeTruthy();
    const download = screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I've read Nova's findings/));
    expect(download.disabled).toBe(false);
  });

  it('flags a certified amount that differs from the amount applied for', async () => {
    fake.on('GET', P, () => app([]));
    renderInProject(<InvoiceDetailScreen commitmentId="cmt_1" claimId="pcl_1" />);
    fireEvent.click(await screen.findByRole('tab', { name: /Summary preview/ }));
    fireEvent.change(await screen.findByLabelText(/Amount certified/), {
      target: { value: '20000.00' },
    });
    expect(await screen.findByText('Certified amount differs')).toBeTruthy();
  });
});
