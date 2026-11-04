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
