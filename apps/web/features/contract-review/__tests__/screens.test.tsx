// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import { DISCLAIMER, WORDING_LABEL, decision, flag, review } from './fixtures';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const perms = vi.hoisted(() => ({ orgRole: 'admin', toolLevels: {} as Record<string, string> }));
vi.mock('@/features/projects', () => ({ useProjectPermissions: () => ({ data: perms }) }));
vi.mock('@/shared/providers/useProjectDirectory', () => ({
  useProjectDirectory: () => ({ personName: (id: string) => (id === 'usr_me' ? 'Test User' : id) }),
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
vi.mock('@/shared/lib/uploads', () => ({ uploadFile: vi.fn(), fileDownloadUrl: vi.fn() }));

const { ReviewScreen } = await import('../screens/ReviewScreen');
const { ReviewsScreen } = await import('../screens/ReviewsScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}/ai/contract-reviews';
const DECIDE = `${P}/{suggestionId}/flags/{flagIndex}/decision`;
const ASK = `${P}/{suggestionId}/questions`;
const FEEDBACK = '/v1/orgs/{orgId}/ai/runs/{runId}/feedback';

beforeEach(() => {
  fake.reset();
  perms.orgRole = 'admin';
  perms.toolLevels = {};
});

const open = async (r = review()) => {
  fake.on('GET', `${P}/{suggestionId}`, () => r);
  renderInProject(<ReviewScreen reviewId="ais_1" />);
  await screen.findByText(DISCLAIMER);
};
const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('ReviewScreen', () => {
  it('exports the review as a PDF download', async () => {
    const create = vi.fn(() => 'blob:review');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf' }));
    expect(revoke).toHaveBeenCalledWith('blob:review');
    click.mockRestore();
  });

  it('shows the fixed disclaimer from the API', async () => {
    await open();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });

  it('cites clause number, page and quote on a flag', async () => {
    await open();
    expect(screen.getAllByText('Clause 34.2 · page 12').length).toBe(1);
    expect(screen.getByText('Liquidated damages are payable at $5,000 per day.')).toBeTruthy();
  });

  it('shows the approved wording label from the API, or refers to the lawyer when none', async () => {
    await open();
    expect(screen.getByText(WORDING_LABEL)).toBeTruthy();
    expect(
      screen.getByText('Half of the security is released at practical completion.'),
    ).toBeTruthy();
    expect(screen.getAllByText('No approved wording for this. Refer to your lawyer.')).toHaveLength(
      2,
    );
  });

  it('lists undecided flags before decided ones', async () => {
    await open(review({ decisions: [decision(0, 'accept_risk')] }));
    expect(titles()).toEqual([
      'Security release',
      'Extension of time notice',
      'Liquidated damages cap',
    ]);
    expect(screen.getByText('1 of 3 flags decided')).toBeTruthy();
  });

  it('needs a reason before "Not relevant" can be recorded', async () => {
    const user = userEvent.setup();
    await open();
    const card = within(screen.getByRole('article', { name: 'Liquidated damages cap' }));
    await user.click(card.getByRole('radio', { name: 'Not relevant' }));
    const button = card.getByRole('button', { name: 'Record decision' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await enterText(user, card.getByLabelText('Why is this not relevant?'), 'Fixed price job');
    expect(button.disabled).toBe(false);
  });

  it('records a decision with the right body and updates the count', async () => {
    const user = userEvent.setup();
    await open();
    fake.on('POST', DECIDE, () => review({ decisions: [decision(0, 'negotiate')] }));
    expect(screen.getByText('0 of 3 flags decided')).toBeTruthy();
    const card = within(screen.getByRole('article', { name: 'Liquidated damages cap' }));
    await user.click(card.getByRole('radio', { name: 'Negotiate' }));
    await enterText(user, card.getByLabelText('Note (optional)'), ' Ask for a cap ');
    await user.click(card.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('1 of 3 flags decided');
    const call = fake.callsTo('POST', DECIDE)[0]!;
    expect(call.init.body).toMatchObject({ decision: 'negotiate', note: 'Ask for a cap' });
    expect(call.init.params?.path).toMatchObject({ suggestionId: 'ais_1', flagIndex: '0' });
  });

  it('disables decision controls for people outside the commercial team', async () => {
    perms.orgRole = 'member';
    await open();
    for (const r of screen.getAllByRole('radio')) expect(r.matches(':disabled')).toBe(true);
    for (const b of screen.getAllByRole('button', { name: 'Record decision' }))
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no approve, sign, send or wording-generating control', async () => {
    const user = userEvent.setup();
    await open(review({ flags: [flag(), flag({ approvedWording: null, wordingStatus: 'none' })] }));
    const forbidden = /\bapprove\b|\bsign\b|send contract|generate wording/i;
    for (const tab of ['Summary', 'Flags', 'Time bars']) {
      await user.click(screen.getByRole('tab', { name: new RegExp(tab) }));
      for (const b of screen.queryAllByRole('button')) expect(b.textContent).not.toMatch(forbidden);
      expect(document.body.textContent).not.toMatch(forbidden);
    }
  });
});

describe('ReviewsScreen', () => {
  it('lists earlier reviews with their decided count', async () => {
    fake.on('GET', P, () => ({ data: [review({ decisions: [decision(1, 'negotiate')] })] }));
    renderInProject(<ReviewsScreen />);
    expect(await screen.findByText('Head contract.pdf')).toBeTruthy();
    expect(screen.getByText(/1 of 3 flags decided/)).toBeTruthy();
  });

  it('shows "Commercial team only" and loads nothing for other members', async () => {
    perms.orgRole = 'member';
    renderInProject(<ReviewsScreen />);
    expect(screen.getByText('Commercial team only')).toBeTruthy();
    expect(screen.queryByText('Review a contract')).toBeNull();
    await waitFor(() => expect(fake.callsTo('GET', P)).toHaveLength(0));
  });
});

const answer = (over: Record<string, unknown> = {}) => ({
  runId: 'air_9',
  question: 'How much retention?',
  kind: 'answered',
  answer: 'The contract says the Principal holds 5% retention.',
  citations: [{ page: 7, clause: '14.1', quote: 'The Principal holds retention of 5%.' }],
  droppedCitations: 0,
  unreadPages: [],
  truncated: false,
  ...over,
});

describe('Ask tab', () => {
  const openAsk = async (r = review()) => {
    await open(r);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Ask/ }));
    return user;
  };

  it('asks a question and shows the answer with its clause', async () => {
    fake.on('POST', ASK, () => answer());
    const user = await openAsk();
    const button = screen.getByRole('button', { name: 'Ask Nova' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await enterText(
      user,
      screen.getByLabelText('Where does the contract say…?'),
      '  How much retention? ',
    );
    await user.click(button);
    const card = await screen.findByRole('article', { name: 'Answer to: How much retention?' });
    expect(
      within(card).getByText('The contract says the Principal holds 5% retention.'),
    ).toBeTruthy();
    expect(within(card).getByText('Clause 14.1 · page 7')).toBeTruthy();
    expect(fake.callsTo('POST', ASK)[0]!.init).toMatchObject({
      params: { path: { orgId: 'org_test', projectId: 'prj_test', suggestionId: 'ais_1' } },
      body: { question: 'How much retention?' },
    });
    // The box clears for the next question.
    expect(
      (screen.getByLabelText('Where does the contract say…?') as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('shows the API wording when the contract is silent, and says which pages Nova could not read', async () => {
    fake.on('POST', ASK, () =>
      answer({
        kind: 'not_addressed',
        answer: "The contract doesn't address this.",
        citations: [],
        unreadPages: [4, 5],
      }),
    );
    const user = await openAsk();
    await enterText(
      user,
      screen.getByLabelText('Where does the contract say…?'),
      'Defects period?',
    );
    await user.click(screen.getByRole('button', { name: 'Ask Nova' }));
    expect(await screen.findByText("The contract doesn't address this.")).toBeTruthy();
    expect(screen.getByText(/couldn't read pages 4, 5/)).toBeTruthy();
    expect(screen.queryByText(/page \d+$/)).toBeNull();
  });

  it('sends a thumbs up for the run', async () => {
    fake.on('POST', ASK, () => answer());
    fake.on('PUT', FEEDBACK, () => undefined);
    const user = await openAsk();
    await enterText(
      user,
      screen.getByLabelText('Where does the contract say…?'),
      'How much retention?',
    );
    await user.click(screen.getByRole('button', { name: 'Ask Nova' }));
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', { name: 'Helpful' }));
    await waitFor(() =>
      expect(fake.callsTo('PUT', FEEDBACK)[0]!.init).toMatchObject({
        params: { path: { orgId: 'org_test', runId: 'air_9' } },
        body: { rating: 'up' },
      }),
    );
  });

  it('shows the error when Nova cannot answer', async () => {
    fake.on('POST', ASK, () => {
      throw new Error('boom');
    });
    const user = await openAsk();
    await enterText(
      user,
      screen.getByLabelText('Where does the contract say…?'),
      'How much retention?',
    );
    await user.click(screen.getByRole('button', { name: 'Ask Nova' }));
    expect(await screen.findByText("Nova couldn't answer that")).toBeTruthy();
  });
});

const COMPARE = '/v1/orgs/{orgId}/projects/{projectId}/ai/contract-compares';
const side = {
  suggestionId: 'ais_1',
  fileName: 'Head contract.pdf',
  pageCount: 30,
  unreadPages: [],
  truncated: false,
};
const comparison = (over: Record<string, unknown> = {}) => ({
  runId: 'air_7',
  base: side,
  other: { ...side, suggestionId: 'ais_2', fileName: 'Revision 2.pdf' },
  dropped: { notOnPage: 0, bannedWords: 0, notAChange: 0 },
  changes: [
    {
      kind: 'changed',
      topic: 'Retention',
      summary: 'Retention rises from 5% to 10%.',
      base: { page: 7, clause: '14.1', quote: 'The Principal holds retention of 5%.' },
      other: { page: 8, clause: '14.1', quote: 'The Principal holds retention of 10%.' },
    },
    {
      kind: 'added',
      topic: 'Security',
      summary: 'A security of 2% is added.',
      base: null,
      other: { page: 9, clause: '25.2', quote: 'The Contractor pays a security of 2%.' },
    },
  ],
  ...over,
});

describe('Compare tab', () => {
  const openCompare = async (
    others = [review({ suggestionId: 'ais_2', fileName: 'Revision 2.pdf' })],
  ) => {
    fake.on('GET', P, () => ({ data: [review(), ...others] }));
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Compare/ }));
    return user;
  };

  it('compares with another review and shows each change with the clause from both contracts', async () => {
    fake.on('POST', COMPARE, () => comparison());
    const user = await openCompare();
    const button = screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // The review being viewed is not offered as the other side.
    const select = (await screen.findByLabelText(
      'Compare this contract with',
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    await user.selectOptions(select, 'ais_2');
    await user.click(button);
    const card = await screen.findByRole('article', { name: 'Changed: Retention' });
    expect(within(card).getByText('Retention rises from 5% to 10%.')).toBeTruthy();
    expect(within(card).getByText('Clause 14.1 · page 7')).toBeTruthy();
    expect(within(card).getByText('Clause 14.1 · page 8')).toBeTruthy();
    const added = screen.getByRole('article', { name: 'Added: Security' });
    expect(within(added).getByText('Not in this contract.')).toBeTruthy();
    expect(screen.getByText('2 changes found')).toBeTruthy();
    expect(fake.callsTo('POST', COMPARE)[0]!.init).toMatchObject({
      params: { path: { orgId: 'org_test', projectId: 'prj_test' } },
      body: { baseReviewId: 'ais_1', otherReviewId: 'ais_2' },
    });
  });

  it('says so when there is nothing else to compare with', async () => {
    await openCompare([]);
    expect(await screen.findByText(/No other reviewed contract on this project yet/)).toBeTruthy();
  });

  it('does not read "no changes" as "the same", and says what was not read or not supported', async () => {
    fake.on('POST', COMPARE, () =>
      comparison({
        changes: [],
        dropped: { notOnPage: 2, bannedWords: 0, notAChange: 0 },
        other: { ...side, suggestionId: 'ais_2', fileName: 'Revision 2.pdf', unreadPages: [4, 5] },
      }),
    );
    const user = await openCompare();
    const select = (await screen.findByLabelText(
      'Compare this contract with',
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    await user.selectOptions(select, 'ais_2');
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(await screen.findByText(/does not mean the contracts match/)).toBeTruthy();
    expect(screen.getByText('Part of Revision 2.pdf was not read')).toBeTruthy();
    expect(screen.getByText(/Pages 4, 5 have no text/)).toBeTruthy();
    expect(screen.getByText(/2 changes that could not be supported/)).toBeTruthy();
  });

  it('shows the error when Nova cannot compare', async () => {
    fake.on('POST', COMPARE, () => {
      throw new Error('boom');
    });
    const user = await openCompare();
    const select = (await screen.findByLabelText(
      'Compare this contract with',
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    await user.selectOptions(select, 'ais_2');
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(await screen.findByText("Nova couldn't compare these contracts")).toBeTruthy();
  });
});
