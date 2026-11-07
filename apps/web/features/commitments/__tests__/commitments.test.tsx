// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import type { ChangeOrder, Commitment, CommitmentSummary } from '../data/api';
import { parseSignedAmount, percentOf, sumAmounts } from '../lib/money';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { CommitmentsScreen } = await import('../screens/CommitmentsScreen');
const { CommitmentScreen } = await import('../screens/CommitmentScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const fig = (count: number, amount: string) => ({ count, amount });
const summary: CommitmentSummary = {
  approvedCommitments: fig(2, '30000.00'),
  pendingCommitments: fig(1, '500.00'),
  draftCommitments: fig(1, '100.00'),
  approvedChangeOrders: fig(1, '5000.00'),
  pendingChangeOrders: fig(1, '250.00'),
  draftChangeOrders: fig(0, '0.00'),
  payments: fig(2, '10500.00'),
};
const c = (over: Partial<Commitment>): Commitment => ({
  id: 'cmt_1',
  number: 1,
  kind: 'subcontract',
  title: 'Concrete supply',
  vendorCompanyId: null,
  status: 'approved',
  total: '20000.00',
  overBudgetOverride: false,
  submittedAt: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});
const cco = (over: Partial<ChangeOrder>): ChangeOrder => ({
  id: 'cco_1',
  number: 1,
  title: 'Extra circuits',
  budgetLineId: 'bln_1',
  amount: '5000.00',
  status: 'submitted',
  submittedAt: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

beforeEach(() => fake.reset());

describe('money helpers', () => {
  it('sums in whole cents and works out percent paid', () => {
    expect(sumAmounts('0.10', '0.20', '-0.05')).toBe('0.25');
    expect(percentOf('10500.00', '35000.00')).toBe('30.0');
    expect(percentOf('1', '0')).toBe('0.0');
    expect(parseSignedAmount('-800')).toBe('-800');
    expect(parseSignedAmount('0')).toBeNull();
  });
});

describe('CommitmentsScreen', () => {
  it('shows the totals bar with change orders and payments', async () => {
    fake.on('GET', `${P}/commitments`, () => ({
      data: [c({}), c({ id: 'cmt_2', number: 2, title: 'Crane hire' })],
    }));
    fake.on('GET', `${P}/commitment-summary`, () => summary);
    renderInProject(<CommitmentsScreen />);
    expect(await screen.findByText('Concrete supply')).toBeTruthy();
    expect(await screen.findByText('Revised committed')).toBeTruthy();
    expect(screen.getByText('30.0%')).toBeTruthy();
    expect(screen.getByText('Crane hire')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    fake.on('GET', `${P}/commitments`, () => ({ data: [] }));
    fake.on('GET', `${P}/commitment-summary`, () => summary);
    renderInProject(<CommitmentsScreen />);
    expect(await screen.findByText('No commitments yet')).toBeTruthy();
  });
});

describe('CommitmentScreen', () => {
  function seed(status: Commitment['status']) {
    fake.on('GET', `${P}/commitments/{commitmentId}`, () => ({
      commitment: c({ status }),
      lines: [{ budgetLineId: 'bln_1', description: 'Rough-in', amount: '20000.00' }],
    }));
    fake.on('GET', `${P}/commitments/{commitmentId}/change-orders`, () => ({ data: [cco({})] }));
    fake.on('GET', `${P}/commitments/{commitmentId}/payments`, () => ({
      data: [
        {
          id: 'cpy_1',
          number: 1,
          amount: '1000.00',
          paidOn: '2026-10-01',
          reference: null,
          status: 'recorded',
          voidReason: null,
        },
      ],
    }));
  }

  it('shows revised value and paid, and approves a submitted change order', async () => {
    seed('approved');
    const approve = vi.fn(() => cco({ status: 'approved' }));
    fake.on(
      'POST',
      `${P}/commitments/{commitmentId}/change-orders/{changeOrderId}/approve`,
      approve,
    );
    renderInProject(<CommitmentScreen commitmentId="cmt_1" />);
    expect(await screen.findByText('Revised value')).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve CCO-001' }));
    await waitFor(() => expect(approve).toHaveBeenCalled());
  });

  it('records a payment and rejects a bad amount', async () => {
    seed('approved');
    const record = vi.fn(() => ({
      id: 'cpy_2',
      number: 2,
      amount: '500.00',
      paidOn: '2026-10-02',
      reference: null,
      status: 'recorded',
      voidReason: null,
    }));
    fake.on('POST', `${P}/commitments/{commitmentId}/payments`, record);
    renderInProject(<CommitmentScreen commitmentId="cmt_1" />);
    await screen.findByText('Record a payment');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('Enter the amount ex GST, above zero.')).toBeTruthy();
    await enterText(user, screen.getByLabelText(/Amount \(ex GST\)$/), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(record).toHaveBeenCalled());
  });

  it('keeps change orders and payments closed until approval', async () => {
    seed('draft');
    renderInProject(<CommitmentScreen commitmentId="cmt_1" />);
    expect(await screen.findByText(/open up once the commitment is approved/)).toBeTruthy();
  });
});
