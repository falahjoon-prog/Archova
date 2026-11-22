// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import { fakeProblem } from '@/test/fake-api';
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
  costCodeId: null,
  changeEventId: null,
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
  attention: null,
  ...over,
});
const detail = (over: Partial<PaymentClaim> = {}): PaymentClaimDetail => ({
  claim: claim(over),
  statement: null,
  warnings: [],
  timeline: [],
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
  it('lists the claims that need a look now, overdue first', async () => {
    const hot = (n: number, status: 'overdue' | 'due_soon', dueOn: string) =>
      claim({
        id: `pcl_${n}`,
        number: n,
        attention: { label: 'Payment schedule deadline', dueOn, status, note: null },
      });
    fake.on('GET', `${P}/payment-claims`, () => ({
      data: [
        hot(1, 'due_soon', '2026-10-27'),
        claim({ id: 'pcl_9', number: 9 }),
        hot(2, 'overdue', '2026-10-20'),
      ],
    }));
    fake.on('GET', `${P}/contracts`, () => ({ data: [{ id: 'cnt_1', title: 'Electrical' }] }));
    renderInProject(<ClaimsRegisterScreen />);
    const panel = await screen.findByRole('region', { name: 'Needs attention' });
    const items = Array.from(panel.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/claim 2.*Overdue/);
    expect(items[1]).toMatch(/claim 1.*Due soon/);
  });

  it('shows no attention panel when nothing is urgent', async () => {
    fake.on('GET', `${P}/payment-claims`, () => ({ data: [claim()] }));
    fake.on('GET', `${P}/contracts`, () => ({ data: [{ id: 'cnt_1', title: 'Electrical' }] }));
    renderInProject(<ClaimsRegisterScreen />);
    await screen.findByText('Electrical, claim 1');
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

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
  it('records an adjudication from the dates on the notices', async () => {
    const PUT = `${P}/payment-claims/{claimId}/adjudication`;
    const overdue = {
      key: 'adjudication_notice' as const,
      label: 'Last day to serve notice of intention to apply for adjudication',
      dueOn: '2026-12-02',
      doneOn: null,
      status: 'upcoming' as const,
      note: null,
    };
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => ({ ...detail(), timeline: [overdue] }));
    fake.on('PUT', PUT, () => ({ ...detail(), timeline: [overdue] }));
    const user = userEvent.setup();
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    await user.click(await screen.findByRole('button', { name: 'Record adjudication' }));
    await user.type(screen.getByLabelText('Notice of intention served on'), '2026-11-10');
    await user.type(screen.getByLabelText('Adjudicator'), 'A. Person');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(fake.callsTo('PUT', PUT)).toHaveLength(1));
    expect(fake.callsTo('PUT', PUT)[0]!.init.body).toEqual({
      noticeServedOn: '2026-11-10',
      adjudicatorName: 'A. Person',
    });
  });

  it('does not show the adjudication card while nothing about adjudication applies', async () => {
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => detail());
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    await screen.findByText(/Lines claimed/);
    expect(screen.queryByText('Adjudication record')).toBeNull();
  });

  it('schedules line by line: a reduced line needs its own reason, then sends only the reduced lines', async () => {
    const SCHEDULE = `${P}/payment-claims/{claimId}/schedule`;
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => detail());
    fake.on('POST', SCHEDULE, () => ({
      ...detail({ status: 'scheduled' }),
      schedule: {
        id: 'psc_1',
        scheduledAmount: '22800.00',
        withheldAmount: '5700.00',
        overallReason: null,
        lineReasons: [],
        issuedAt: '2026-10-27T01:00:00Z',
        issuedWithinTime: true,
      },
    }));
    const user = userEvent.setup();
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    await user.click(await screen.findByRole('button', { name: 'Schedule line by line' }));
    const amount = screen.getByLabelText(/E1 Rough-in: amount to schedule/);
    await user.clear(amount);
    await user.type(amount, '24000.00');
    // 30,000 claimed, 24,000 scheduled; retention is recalculated by the server, so the form shows lines only.
    expect(document.body.textContent).toMatch(/\$24,000\.00/);
    expect(document.body.textContent).toMatch(/Retention is recalculated/);
    await user.click(screen.getByRole('button', { name: 'Issue payment schedule' }));
    expect(await screen.findByText(/Give the reason for reducing E1 Rough-in/)).toBeTruthy();
    expect(fake.callsTo('POST', SCHEDULE)).toHaveLength(0);
    await user.type(
      screen.getByLabelText(/Reason for reducing E1 Rough-in/),
      'Level 2 conduits not installed.',
    );
    await user.click(screen.getByRole('button', { name: 'Add a set-off or back-charge' }));
    await user.type(
      screen.getByLabelText(/Deduction 1: what is being withheld/),
      'Back-charge: cleaning',
    );
    await user.type(screen.getByLabelText(/Deduction 1: amount withheld/), '500.00');
    await user.type(
      screen.getByLabelText(/Deduction 1: reason/),
      'Cleaning done by us, invoice 114.',
    );
    await user.click(screen.getByRole('button', { name: 'Issue payment schedule' }));
    await waitFor(() => expect(fake.callsTo('POST', SCHEDULE)).toHaveLength(1));
    expect(fake.callsTo('POST', SCHEDULE)[0]!.init.body).toEqual({
      lines: [
        {
          sovItemId: 'sov_1',
          scheduledAmount: '24000.00',
          reason: 'Level 2 conduits not installed.',
        },
      ],
      deductions: [
        {
          description: 'Back-charge: cleaning',
          amount: '500.00',
          reason: 'Cleaning done by us, invoice 114.',
        },
      ],
    });
  });

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

  it('asks for an acknowledgement when a required declaration is missing, then sends it', async () => {
    const SCHEDULE = `${P}/payment-claims/{claimId}/schedule`;
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => detail());
    let calls = 0;
    fake.on('POST', SCHEDULE, () => {
      calls += 1;
      return calls === 1
        ? {
            ...fakeProblem(422, 'financials.schedule.declarations_missing'),
            errors: [
              { path: 'declarationsOverride', message: 'No payroll tax declaration received.' },
            ],
          }
        : detail({ status: 'scheduled' });
    });
    const user = userEvent.setup();
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    await screen.findByLabelText(/Scheduled amount/);
    await user.click(screen.getByRole('button', { name: 'Issue payment schedule' }));
    expect(await screen.findByText('A declaration this project asks for is missing')).toBeTruthy();
    expect(screen.getByText('No payroll tax declaration received.')).toBeTruthy();
    // It names the way ahead and does not suggest holding the money back.
    expect(screen.getByText(/You can still issue the schedule on time/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Issue payment schedule' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await enterText(
      user,
      screen.getByLabelText(/Why you are going ahead without it/),
      'Paper is coming',
    );
    await user.click(screen.getByRole('button', { name: 'Issue payment schedule' }));
    await waitFor(() => expect(fake.callsTo('POST', SCHEDULE)).toHaveLength(2));
    expect(fake.callsTo('POST', SCHEDULE)[1]!.init.body).toEqual({
      scheduledAmount: '28500.00',
      declarationsOverride: { reason: 'Paper is coming' },
    });
  });

  it('shows the SOPA timeline with the schedule deadline and its status', async () => {
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => ({
      ...detail(),
      timeline: [
        {
          key: 'served',
          label: 'Claim served',
          dueOn: null,
          doneOn: '2026-10-14',
          status: 'done',
          note: null,
        },
        {
          key: 'schedule',
          label: 'Payment schedule deadline',
          dueOn: '2026-10-28',
          doneOn: null,
          status: 'due_soon',
          note: 'If no schedule is given by this day, the full claim is likely payable.',
        },
      ],
    }));
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    expect(await screen.findByText('Payment schedule deadline')).toBeTruthy();
    expect(screen.getByText('Due soon')).toBeTruthy();
    expect(document.body.textContent).toMatch(/full claim is likely payable/);
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

describe('ClaimDetailScreen payments', () => {
  const pay = `${P}/payment-claims/{claimId}/payments`;
  const scheduled = () => ({
    ...detail({ status: 'scheduled' }),
    schedule: {
      id: 'psc_1',
      scheduledAmount: '28500.00',
      withheldAmount: '0.00',
      overallReason: null,
      lineReasons: [],
      issuedAt: '2026-10-20T01:00:00Z',
      issuedWithinTime: true,
    },
  });
  const summary = (payments: object[]) => ({
    claimId: 'pcl_1',
    payments,
    amountDue: '31350.00',
    paid: payments.length ? '10000.00' : '0.00',
    outstanding: payments.length ? '21350.00' : '31350.00',
  });
  const one = {
    id: 'pay_1',
    paidOn: '2026-10-22',
    amount: '10000.00',
    reference: 'REM-9',
    source: 'manual',
    reversesPaymentId: null,
    recordedAt: '2026-10-22T01:00:00Z',
  };

  it('checks the form, records a payment and reverses one', async () => {
    fake.on('GET', `${P}/payment-claims/{claimId}`, scheduled);
    fake.on('GET', pay, () => summary([one]));
    fake.on('POST', pay, () => summary([one]));
    fake.on('POST', `${pay}/{paymentId}/reverse`, () => summary([]));
    const user = userEvent.setup();
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    expect(await screen.findByText('REM-9')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/Enter the amount paid/)).toBeTruthy();
    expect(fake.callsTo('POST', pay)).toHaveLength(0);
    await enterText(user, screen.getByLabelText(/Amount paid/), '10000.00');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/Enter a reference/)).toBeTruthy();
    await enterText(user, screen.getByLabelText('Reference'), 'REM-9');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(fake.callsTo('POST', pay)).toHaveLength(1));
    expect(fake.callsTo('POST', pay)[0]!.init.body).toEqual({
      paidOn: '2026-10-23',
      amount: '10000.00',
      reference: 'REM-9',
    });
    await user.click(screen.getByRole('button', { name: 'Reverse payment REM-9' }));
    await waitFor(() => expect(fake.callsTo('POST', `${pay}/{paymentId}/reverse`)).toHaveLength(1));
  });

  it('shows no payments before a schedule is issued', async () => {
    fake.on('GET', `${P}/payment-claims/{claimId}`, () => detail());
    renderInProject(<ClaimDetailScreen claimId="pcl_1" />);
    await screen.findByText('Rules not yet legally reviewed');
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
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
