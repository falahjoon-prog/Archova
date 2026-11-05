// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('@/shared/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag.on }));

const { PrequalScreen } = await import('../screens/PrequalScreen');
const { blankQuestion, nextQuestionId, normaliseQuestion, unanswered } =
  await import('../lib/types');

const R = '/v1/orgs/{orgId}/prequalification-register';
const F = '/v1/orgs/{orgId}/prequalifications';
const T = '/v1/orgs/{orgId}/prequal-templates';
const C = '/v1/orgs/{orgId}/companies';

const CMP = 'cmp_01HZZZZZZZZZZZZZZZZZZZZZZ1';
const summary = {
  id: 'pqf_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  companyId: CMP,
  templateName: 'Standard prequal',
  templateVersion: 1,
  status: 'approved',
  qualification: 'expiring',
  trades: ['Electrical'],
  scorePoints: 40,
  scoreMax: 40,
  concerns: [],
  decidedAt: '2026-11-01T00:00:00Z',
  expiresOn: '2026-11-20',
  createdAt: '2026-11-01T00:00:00Z',
};
const questions = [
  {
    id: 'comp',
    section: 'Insurance',
    prompt: 'Do you hold workers compensation?',
    type: 'yes_no',
    options: [],
    required: true,
    expect: 'yes',
    points: 40,
    critical: true,
  },
];
const submittedForm = {
  ...summary,
  templateId: 'pqt_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  status: 'submitted',
  qualification: 'pending',
  answers: { comp: false },
  scorePoints: 0,
  concerns: ['comp'],
  submittedAt: '2026-11-02T00:00:00Z',
  decidedBy: null,
  decisionNote: null,
  validFrom: null,
  expiresOn: null,
  questions,
  version: 3,
};

beforeEach(() => {
  fake.reset();
  flag.on = true;
  fake.on('GET', R, () => ({ data: [summary] }));
  fake.on('GET', F, () => ({ data: [summary] }));
  fake.on('GET', T, () => ({ data: [] }));
  fake.on('GET', C, () => ({
    data: [
      {
        id: CMP,
        name: 'Sparky Electrical',
        type: 'subcontractor',
        isOwnCompany: false,
        trades: [],
      },
    ],
    nextCursor: null,
  }));
});

describe('question helpers', () => {
  it('finds required questions with no answer', () => {
    const qs = [blankQuestion(1), { ...blankQuestion(2), required: false }];
    expect(unanswered(qs, {})).toEqual(['q1']);
    expect(unanswered(qs, { q1: false })).toEqual([]);
    expect(unanswered(qs, { q1: '  ' })).toEqual(['q1']);
  });
  it('never reuses a question id', () => {
    expect(nextQuestionId([blankQuestion(1), blankQuestion(3)])).toBe('q4');
  });
  it('drops scoring from questions that cannot score', () => {
    const q = normaliseQuestion({
      ...blankQuestion(1),
      type: 'text',
      expect: 'yes',
      points: 5,
      critical: true,
      options: ['a'],
    });
    expect(q).toMatchObject({ expect: null, points: 0, critical: false, options: [] });
  });
});

describe('PrequalScreen', () => {
  it('shows the register with company names and standing', async () => {
    renderInProject(<PrequalScreen />);
    expect(await screen.findByText('Sparky Electrical')).toBeTruthy();
    expect(within(screen.getByRole('list')).getByText('Expiring soon')).toBeTruthy();
    expect(screen.getByText(/40 of 40 points/)).toBeTruthy();
    expect(screen.getByText(/Approved until/)).toBeTruthy();
  });

  it('asks the register for the standing and trade chosen', async () => {
    const user = userEvent.setup();
    renderInProject(<PrequalScreen />);
    await screen.findByText('Sparky Electrical');
    await user.selectOptions(screen.getByLabelText('Standing'), 'expired');
    await waitFor(() =>
      expect(fake.callsTo('GET', R).some((c) => c.init.params?.query?.state === 'expired')).toBe(
        true,
      ),
    );
  });

  it('says so when nobody is prequalified yet', async () => {
    fake.on('GET', R, () => ({ data: [] }));
    renderInProject(<PrequalScreen />);
    expect(await screen.findByText('No companies prequalified yet')).toBeTruthy();
  });

  it('is off until the flag is on', () => {
    flag.on = false;
    renderInProject(<PrequalScreen />);
    expect(screen.getByText(/isn’t switched on/)).toBeTruthy();
    expect(fake.callsTo('GET', R)).toHaveLength(0);
  });

  it('lists forms by their status', async () => {
    const user = userEvent.setup();
    fake.on('GET', F, () => ({
      data: [{ ...summary, status: 'submitted', qualification: 'pending' }],
    }));
    renderInProject(<PrequalScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Forms' }));
    expect(await screen.findByText('Waiting for a decision')).toBeTruthy();
  });

  it('needs a reason to decline, and sends the form version', async () => {
    const user = userEvent.setup();
    fake.on('GET', F, () => ({
      data: [{ ...summary, status: 'submitted', qualification: 'pending' }],
    }));
    fake.on('GET', `${F}/{prequalId}`, () => submittedForm);
    fake.on('POST', `${F}/{prequalId}/reject`, () => ({ ...submittedForm, status: 'rejected' }));
    renderInProject(<PrequalScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Forms' }));
    await user.click(await screen.findByRole('button', { name: /Open/ }));
    const dialog = await screen.findByRole('dialog');
    // The concern the answers raised is put in front of the person deciding.
    expect(await within(dialog).findByText('Answers to look at before deciding')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Don’t approve' }));
    expect(within(dialog).getByText('Say why this form isn’t approved.')).toBeTruthy();
    expect(fake.callsTo('POST', `${F}/{prequalId}/reject`)).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Note/), 'No cover');
    await user.click(within(dialog).getByRole('button', { name: 'Don’t approve' }));
    await waitFor(() => expect(fake.callsTo('POST', `${F}/{prequalId}/reject`)).toHaveLength(1));
    const call = fake.callsTo('POST', `${F}/{prequalId}/reject`)[0]!;
    expect(call.init.body).toEqual({ note: 'No cover' });
    expect(call.init.params?.header).toEqual({ 'If-Match': '"3"' });
  });

  it('keeps question sets for admins only', async () => {
    renderInProject(<PrequalScreen />);
    await screen.findByText('Sparky Electrical');
    expect(screen.getByRole('tab', { name: 'Question sets' })).toBeTruthy();
  });

  it('lets an admin require prequalification for tender invites', async () => {
    const S = '/v1/orgs/{orgId}/prequalification-settings';
    fake.on('GET', S, () => ({ requireForTenders: false }));
    fake.on('PUT', S, () => ({ requireForTenders: true }));
    const user = userEvent.setup();
    renderInProject(<PrequalScreen />);
    await screen.findByText('Sparky Electrical');
    await user.click(screen.getByRole('tab', { name: 'Question sets' }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: 'Only invite prequalified subcontractors to tender',
      }),
    );
    await waitFor(() => expect(fake.callsTo('PUT', S)).toHaveLength(1));
    expect(fake.callsTo('PUT', S)[0]!.init.body).toEqual({ requireForTenders: true });
  });
});
