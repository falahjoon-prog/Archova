// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { BidBoardScreen } = await import('../screens/BidBoardScreen');
const { responseSummary, summarise } = await import('../lib/types');

const B = '/v1/orgs/{orgId}/bid-board';
const tally = (o: Partial<Record<string, number>> = {}) => ({
  invited: 0,
  viewed: 0,
  declined: 0,
  intendsToQuote: 0,
  submitted: 0,
  awaiting: 0,
  ...o,
});
const entry = (o: Record<string, unknown>) => ({
  id: 'tpk_1',
  projectId: 'prj_1',
  projectName: 'Harbour St Tower',
  numberLabel: 'TP-001',
  name: 'Tiling',
  trade: 'Tiling',
  status: 'out_to_tender',
  dueAt: '2026-11-07T05:00:00Z',
  dueState: 'closing_soon',
  invites: tally({ submitted: 2, declined: 1, invited: 1, awaiting: 1 }),
  quotesConfirmed: 1,
  quotesToReview: 1,
  lowestExGst: '11000.00',
  awarded: false,
  ...o,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', B, () => ({
    data: [
      entry({}),
      entry({
        id: 'tpk_2',
        numberLabel: 'TP-002',
        name: 'Electrical',
        trade: 'Electrical',
        status: 'draft',
        dueAt: null,
        dueState: null,
        invites: tally(),
        quotesConfirmed: 0,
        quotesToReview: 0,
        lowestExGst: null,
      }),
    ],
    asOf: '2026-11-05T00:00:00Z',
    truncated: false,
  }));
});

describe('responseSummary', () => {
  it('words the invitee answers', () => {
    expect(responseSummary(tally({ submitted: 2, declined: 1, invited: 1, awaiting: 1 }))).toBe(
      '2 quoted, 1 declined, 1 awaiting',
    );
    expect(responseSummary(tally())).toBe('No invitees');
  });
  it('summarises the board', () => {
    expect(
      summarise([
        entry({ dueState: 'overdue' }),
        entry({ awarded: true, status: 'awarded', dueState: null }),
      ] as never),
    ).toEqual({ overdue: 1, closingSoon: 0, outToTender: 1, toReview: 2, awarded: 1 });
  });
});

describe('BidBoardScreen', () => {
  it('lists packages across projects with the due state and lowest price', async () => {
    renderInProject(<BidBoardScreen />);
    const link = await screen.findByRole('link', { name: /TP-001 Tiling/ });
    expect(link.getAttribute('href')).toBe('/acme/projects/prj_1/estimating/packages/tpk_1');
    const row = link.closest('tr')!;
    expect(within(row).getByText('Closing soon')).toBeTruthy();
    expect(within(row).getByText('2 quoted, 1 declined, 1 awaiting')).toBeTruthy();
    expect(within(row).getByText('$11,000.00')).toBeTruthy();
    expect(
      screen.getByText(/0 overdue · 1 closing soon · 1 out to tender · 1 quote to review/),
    ).toBeTruthy();
  });

  it('sends the status filter to the API', async () => {
    const user = userEvent.setup();
    renderInProject(<BidBoardScreen />);
    await screen.findByRole('link', { name: /TP-001/ });
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    await vi.waitFor(() =>
      expect(fake.calls.some((c) => c.path === B && c.init.params?.query?.status === 'draft')).toBe(
        true,
      ),
    );
  });

  it('shows an empty state with no packages', async () => {
    fake.on('GET', B, () => ({ data: [], asOf: '2026-11-05T00:00:00Z', truncated: false }));
    renderInProject(<BidBoardScreen />);
    expect(await screen.findByText('No tender packages yet')).toBeTruthy();
  });
});
