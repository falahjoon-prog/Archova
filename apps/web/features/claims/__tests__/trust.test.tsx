// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import type { ContractPaymentSummary, ContractTrust } from '../data/api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { PaymentSummaryPanel } = await import('../components/PaymentSummaryPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}/contracts/{contractId}';
const trust = (over: Partial<ContractTrust> = {}): ContractTrust => ({
  contractId: 'cnt_1',
  requirement: {
    required: true,
    basis: 'QLD project and retention trusts likely apply.',
    rulesReviewed: false,
  },
  account: null,
  position: {
    status: 'not_set_up',
    retentionWithheld: '50000.00',
    released: '0.00',
    requiredInTrust: '50000.00',
    balance: '0.00',
    shortfall: '50000.00',
    interest: '0.00',
  },
  movements: [],
  ...over,
});
const summary = (t: ContractTrust = trust()): ContractPaymentSummary => ({
  contractId: 'cnt_1',
  title: 'Services package',
  claims: [
    {
      claimId: 'pcl_1',
      number: 1,
      periodEnd: '2026-09-30',
      status: 'scheduled',
      claimedTotal: '1045000.00',
      scheduledAmount: '900000.00',
      amountDue: '990000.00',
      paid: '400000.00',
      lastPaidOn: '2026-11-03',
      outstanding: '590000.00',
      paymentDueOn: '2026-10-15',
      overdue: true,
    },
  ],
  totalDue: '990000.00',
  totalPaid: '400000.00',
  trust: t,
});

beforeEach(() => fake.reset());

describe('PaymentSummaryPanel', () => {
  it('shows a payee what is owed, paid and held in trust, with no forms', async () => {
    fake.on('GET', `${P}/payment-summary`, () => summary());
    renderInProject(<PaymentSummaryPanel contractId="cnt_1" canManageTrust={false} />);
    expect(await screen.findByText('Claim 1')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText(/\$590,000\.00/)).toBeTruthy();
    expect(screen.getByText('Account not recorded')).toBeTruthy();
    expect(screen.getByText('Rules not yet legally reviewed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save trust details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record movement' })).toBeNull();
  });

  it('lets staff save the account and record a deposit, checking the form first', async () => {
    fake.on('GET', `${P}/payment-summary`, () => summary());
    fake.on('PUT', `${P}/trust`, () => trust());
    fake.on('POST', `${P}/trust/movements`, () => trust());
    const user = userEvent.setup();
    renderInProject(<PaymentSummaryPanel contractId="cnt_1" canManageTrust />);
    await user.click(await screen.findByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('Save the trust account details first.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save trust details' }));
    expect(
      await screen.findByText('Enter the bank or institution holding the trust.'),
    ).toBeTruthy();
    await enterText(user, screen.getByLabelText('Bank or institution'), 'Example Bank');
    await enterText(user, screen.getByLabelText(/Last four digits/), '4321');
    await user.click(screen.getByRole('button', { name: 'Save trust details' }));
    await waitFor(() => expect(fake.callsTo('PUT', `${P}/trust`)).toHaveLength(1));
    expect(fake.callsTo('PUT', `${P}/trust`)[0]!.init.body).toEqual({
      governmentClient: false,
      institution: 'Example Bank',
      accountName: null,
      accountLast4: '4321',
      openedOn: null,
    });
  });

  it('sends a deposit once the account is recorded', async () => {
    const withAccount = trust({
      account: {
        governmentClient: false,
        institution: 'Example Bank',
        accountName: null,
        accountLast4: '4321',
        openedOn: null,
      },
    });
    fake.on('GET', `${P}/payment-summary`, () => summary(withAccount));
    fake.on('POST', `${P}/trust/movements`, () => withAccount);
    const user = userEvent.setup();
    renderInProject(<PaymentSummaryPanel contractId="cnt_1" canManageTrust />);
    await screen.findByText('Claim 1');
    await enterText(user, screen.getByLabelText('Amount'), '50000.00');
    await enterText(user, screen.getByLabelText('Date'), '2026-10-20');
    await enterText(user, screen.getByLabelText('Reference'), 'TT-1');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/trust/movements`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/trust/movements`)[0]!.init.body).toEqual({
      kind: 'deposit',
      amount: '50000.00',
      movedOn: '2026-10-20',
      reference: 'TT-1',
    });
  });
});
