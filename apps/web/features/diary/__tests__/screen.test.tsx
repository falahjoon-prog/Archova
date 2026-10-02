// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject, enterText } from '@/test/render';
import { diarySource, resetDiaryPreview } from '../data/source';
import { DiaryDayScreen } from '../screens/DiaryDayScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeAll(() => {
  // Thursday 2 Oct 2026, 4pm in Sydney: today's entry isn't late yet.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T06:00:00Z'));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  resetDiaryPreview();
  nav.search = '';
  nav.pushed = [];
});

describe('DiaryDayScreen', () => {
  it("opens today with yesterday's companies copied and headcount blank (DIA-AC1, DIA-AC3)", async () => {
    renderInProject(<DiaryDayScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Friday 2 October 2026' }),
    ).toBeTruthy();
    const formwork = (await screen.findByLabelText(
      'Cornerstone Formwork headcount',
    )) as HTMLInputElement;
    expect(formwork.value).toBe('');
    expect(screen.getByText(/Observations from Sydney \(Observatory Hill\)/)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Recent days' })).toBeTruthy();
  });

  it('submits and locks the day, then needs a reason to amend (X42, DIA-AC8)', async () => {
    const user = userEvent.setup();
    renderInProject(<DiaryDayScreen />);
    await screen.findByLabelText('Cornerstone Formwork headcount');
    await screen.findByRole('link', { name: /^Today/ });
    for (const [company, n] of [
      ['Harbourline Constructions', '2'],
      ['Cornerstone Formwork', '5'],
      ['Brightwire Electrical', '3'],
    ] as const) {
      await user.type(screen.getByLabelText(`${company} headcount`), n);
    }
    expect(screen.getByText('10 people · 0 hours')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit day' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit and lock' }));
    expect(await screen.findByText('Locked')).toBeTruthy();
    expect(screen.queryByLabelText('Cornerstone Formwork headcount')).toBeNull();
    expect(screen.queryByText('Late entry')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Amend' }));
    const field = screen.getByLabelText('Cornerstone Formwork headcount');
    await user.clear(field);
    await user.type(field, '6');
    await user.click(screen.getByRole('button', { name: 'Save amendment' }));
    const amend = screen.getByRole('dialog', { name: 'Save amendment' });
    expect(within(amend).getByText(/Labour · Cornerstone Formwork headcount/)).toBeTruthy();
    await user.click(within(amend).getByRole('button', { name: 'Save amendment' }));
    expect(within(amend).getByText('Give a reason for the amendment.')).toBeTruthy();
    await enterText(user, within(amend).getByLabelText('Reason'), 'Recounted at knock-off');
    await user.click(within(amend).getByRole('button', { name: 'Save amendment' }));
    expect(await screen.findByRole('link', { name: 'Amended ×1' })).toBeTruthy();
    expect(screen.getByText('Reason: Recounted at knock-off')).toBeTruthy();
  });

  it('flags a possible weather delay when the site was stood down (F1.7 step 3)', async () => {
    const user = userEvent.setup();
    renderInProject(<DiaryDayScreen />);
    await user.click(await screen.findByRole('switch', { name: 'Site stood down' }));
    const flag = await screen.findByText(/no weather delay is recorded/);
    const block = flag.closest('section')!;
    await user.click(within(block).getByRole('button', { name: 'Add a weather delay' }));
    const delay = screen.getByRole('group', { name: 'Delay 1' });
    expect(
      (within(delay).getByLabelText('Possible extension of time') as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.queryByText(/no weather delay is recorded/)).toBeNull();
  });

  it('shows a late, amended day read-only with its history', async () => {
    renderInProject(<DiaryDayScreen date="2026-09-29" />);
    expect(await screen.findByText('Late entry')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Amended ×1' })).toBeTruthy();
    expect(screen.getByText(/Electrical crew numbers confirmed/)).toBeTruthy();
    expect(screen.getByText('submitted the day late')).toBeTruthy();
  });

  it('autosaves the draft to the server after a pause', async () => {
    const user = userEvent.setup();
    renderInProject(<DiaryDayScreen />);
    await screen.findByRole('link', { name: /^Today/ });
    await enterText(user, await screen.findByRole('textbox', { name: 'Notes' }), 'Crane booked');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    await waitFor(async () => {
      const saved = await diarySource.list('prj_test', '2026-10-02', '2026-10-02');
      expect(saved[0]?.content.notes).toBe('Crane booked');
    });
    expect(screen.getByText('Draft saved')).toBeTruthy();
  });
});
