// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import type { PaymentClaim, PaymentClaimDetail } from '../data/api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('@/features/projects', () => ({
  useProjectPermissions: () => ({
    data: { orgRole: 'admin', toolLevels: { payment_claims: 'admin' } },
  }),
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { ClaimDetailScreen } = await import('../screens/ClaimDetailScreen');
const { ClaimsRegisterScreen } = await import('../screens/ClaimsRegisterScreen');
const { ContractDetailScreen } = await import('../screens/ContractDetailScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const variation = (over: Record<string, unknown> = {}) => ({
  id: 'var_1',
  contractId: 'cnt_1',
  number: 1,
  title: 'Extra circuits',
  description: null,
  amount: '5000.00',
  timeImpactDays: 3,
  status: 'submitted',
  claimedToDate: '0.00',
  submittedAt: '2026-10-20T00:00:00Z',
  decidedAt: null,
  decisionNote: null,
  ...over,
});
const claim = (over: Partial<PaymentClaim> = {}): PaymentClaim => ({
  id: 'pcl_1',
  contractId: 'cnt_1',
  number: 1,
  periodEnd: '2026-09-30',
  receivedAt: '2026-10-13T23:00:00Z',
  statesAct: true,
  isValid: true,
  invalidReason: null,
  claimedGross: '30000.00',
  lessPrevious: '0.00',
  retention: '1500.00',
  claimedNet: '28500.00',
  gst: '2850.00',
  claimedTotal: '31350.00',
  servedOn: '2026-10-14',
  scheduleDueOn: '2026-10-28',
  paymentDueOn: '2026-11-11',
  paymentReadDown: false,
  ruleState: 'NSW',
  rulesReviewed: false,
  status: 'submitted',
  daysToScheduleDue: 4,
  ...over,
});
const detail = (over: Partial<PaymentClaim> = {}): PaymentClaimDetail => ({
  claim: claim(over),
  statement: null,
  warnings: [],
  lines: [
    {
      sovItemId: 'sov_1',
      variationId: null,
      previous: '0.00',
      thisClaim: '30000.00',
      toDate: '30000.00',
    },
  ],
  schedule: null,
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T01:00:00Z'));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/permissions`, () => ({
    orgRole: 'admin',
    isExternal: false,
    projectId: 'prj_test',
    companyId: 'cmp_builder',
    isProjectMember: true,
    toolLevels: { payment_claims: 'admin' },
    granular: [],
    denied: [],
    companyScopedTools: [],
  }));
  fake.on('GET', `${P}/contracts/{contractId}/variations`, () => ({
    data: [variation()],
    approvedTotal: '0.00',
  }));
  fake.on('GET', `${P}/payment-claims`, () => ({ data: [] }));
  fake.on('GET', `${P}/contracts/{contractId}`, () => ({
    contract: {
      id: 'cnt_1',
      title: 'Electrical',
      kind: 'subcontract',
      payeeCompanyId: null,
      originalValue: '100000.00',
      retentionPct: '5.00',
      retentionCapPct: null,
      sopaState: 'NSW',
      scheduleDays: null,
      paymentDays: null,
    },
    sov: [{ id: 'sov_1', code: 'E1', description: 'Rough-in', value: '60000.00' }],
  }));
});

describe('ClaimsRegisterScreen', () => {
  it('shows the countdown to each schedule deadline and the dates the rules gave', async () => {
    fake.on('GET', `${P}/payment-claims`, () => ({ data: [claim()] }));
    fake.on('GET', `${P}/contracts`, () => ({ data: [{ id: 'cnt_1', title: 'Electrical' }] }));
    renderInProject(<ClaimsRegisterScreen />);
    expect(await screen.findByRole('link', { name: 'Electrical, claim 1' })).toBeTruthy();
    // Fri 23 Oct to Wed 28 Oct: 3 business days, a warning.
    expect(screen.getByText('3 business days left')).toBeTruthy();
  });
});

describe('ClaimDetailScreen', () => {
  it('asks for reasons before a reduced payment schedule can be issued', async () => {
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => detail());
    fake.on('POST', `${P}/payment-claims/{claimId}/schedule`, () => ({
      ...detail({ status: 'scheduled' }),
      schedule: {
        id: 'psc_1',
        scheduledAmount: '20000.00',
        withheldAmount: '8500.00',
        overallReason: 'Rough-in incomplete',
        lineReasons: [],
        issuedAt: '2026-10-23T01:00:00Z',
        issuedWithinTime: true,
      },
    }));
    const user = userEvent.setup();
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    expect(await screen.findByText('Rules not yet legally reviewed')).toBeTruthy();
    const amount = await screen.findByLabelText(/Scheduled amount/);
    await user.clear(amount);
    await enterText(user, amount, '20000.00');
    await user.click(screen.getByRole('button', { name: 'Issue payment schedule' }));
    expect(await screen.findByText(/Give the reasons for the reduction/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/payment-claims/{claimId}/schedule`)).toHaveLength(0);

    await enterText(
      user,
      screen.getByLabelText(/Reasons for the reduction/),
      'Rough-in incomplete',
    );
    await user.click(screen.getByRole('button', { name: 'Issue payment schedule' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/payment-claims/{claimId}/schedule`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/payment-claims/{claimId}/schedule`)[0]!.init.body).toEqual({
      scheduledAmount: '20000.00',
      overallReason: 'Rough-in incomplete',
    });
  });

  it('warns about a missing subcontractor’s statement without blocking, and links one', async () => {
    const stmt = `${P}/payment-claims/{claimId}/subcontractor-statement`;
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => ({
      ...detail(),
      warnings: ['subcontractor_statement_missing'],
    }));
    fake.on('PUT', stmt, () => ({
      ...detail(),
      statement: {
        periodEnd: '2026-09-30',
        receivedOn: '2026-10-14',
        signedOn: null,
        note: null,
        recordedAt: '2026-10-14T01:00:00Z',
      },
    }));
    const user = userEvent.setup();
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    expect(await screen.findByText(/No subcontractor’s statement linked/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/does not stop the claim/);
    expect(document.body.textContent).not.toMatch(/withhold(?!ing payment)/i);
    // The schedule form is still there.
    expect(screen.getByRole('button', { name: 'Issue payment schedule' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Link the statement' }));
    await user.click(screen.getByRole('button', { name: 'Save statement' }));
    expect(await screen.findByText(/Enter the period the statement covers/)).toBeTruthy();
    expect(fake.callsTo('PUT', stmt)).toHaveLength(0);
    await enterText(user, screen.getByLabelText(/Received on/), '2026-10-14');
    await user.click(screen.getByRole('button', { name: 'Save statement' }));
    await waitFor(() => expect(fake.callsTo('PUT', stmt)).toHaveLength(1));
    expect(fake.callsTo('PUT', stmt)[0]!.init.body).toEqual({
      periodEnd: '2026-09-30',
      receivedOn: '2026-10-14',
    });
  });

  it('explains a claim that is not valid and offers no schedule', async () => {
    fake.on('GET', `${P}/payment-claims/{claimId}`, () =>
      detail({
        isValid: false,
        scheduleDueOn: null,
        paymentDueOn: null,
        invalidReason: 'act_statement_missing',
      }),
    );
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    expect(await screen.findByText('Not a valid payment claim')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Issue payment schedule' })).toBeNull();
  });
});

describe('ContractDetailScreen variations', () => {
  it('approves a submitted variation and needs a reason to reject one', async () => {
    fake.on('POST', `${P}/variations/{variationId}/approve`, () =>
      variation({ status: 'approved' }),
    );
    fake.on('POST', `${P}/variations/{variationId}/reject`, () =>
      variation({ status: 'rejected', decisionNote: 'Out of scope' }),
    );
    const user = userEvent.setup();
    renderInProject(<ContractDetailScreen contractId="cnt_1" />);
    await user.click(await screen.findByRole('button', { name: 'Reject variation 1' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(await screen.findByText('Give the reason for rejecting this variation.')).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/variations/{variationId}/reject`)).toHaveLength(0);
    await enterText(user, screen.getByLabelText(/Reason for rejecting/), 'Out of scope');
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/variations/{variationId}/reject`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/variations/{variationId}/reject`)[0]!.init.body).toEqual({
      note: 'Out of scope',
    });
    await user.click(screen.getByRole('button', { name: 'Approve variation 1' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/variations/{variationId}/approve`)).toHaveLength(1),
    );
  });

  it('offers only approved variations as claimable lines', async () => {
    fake.on('GET', `${P}/contracts/{contractId}/variations`, () => ({
      data: [
        variation({ status: 'approved' }),
        variation({ id: 'var_2', number: 2, title: 'Draft one', status: 'draft' }),
      ],
      approvedTotal: '5000.00',
    }));
    renderInProject(<ContractDetailScreen contractId="cnt_1" />);
    expect(await screen.findByLabelText('Variation 1 Extra circuits')).toBeTruthy();
    expect(screen.queryByLabelText('Variation 2 Draft one')).toBeNull();
  });
});
