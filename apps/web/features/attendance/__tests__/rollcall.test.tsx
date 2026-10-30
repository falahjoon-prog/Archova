// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { attendancePreview, resetRollCallPreview } from '../data/source';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { RollCallScreen } from '../screens/RollCallScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetRollCallPreview();
  nav.search = '';
});

async function startOne(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start roll call' }));
  await enterText(user, screen.getByLabelText('Reason'), 'Fire alarm');
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Start roll call' }));
  await screen.findByText(/0 of 3 accounted for/);
}

describe('RollCallScreen', () => {
  it('starts a roll call from who is on site, grouped by company with phones', async () => {
    const user = userEvent.setup();
    renderInProject(<RollCallScreen />);
    await startOne(user);
    expect(screen.getByRole('heading', { name: 'Fire alarm' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Hunter Concrete' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '0400 000 000' }).length).toBe(3);
  });

  it('ticks people off and shows the progress', async () => {
    const user = userEvent.setup();
    renderInProject(<RollCallScreen />);
    await startOne(user);
    const sam = screen.getByRole('group', { name: 'Mark Sam Nguyen' });
    await user.click(within(sam).getByRole('button', { name: 'Accounted for' }));
    await screen.findByText(/1 of 3 accounted for · 2 to check/);
    expect(
      within(sam).getByRole('button', { name: 'Accounted for' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const jo = screen.getByRole('group', { name: 'Mark Jo Tran' });
    await user.click(within(jo).getByRole('button', { name: 'Missing' }));
    await screen.findByText(/1 missing/);
  });

  it('warns about people not accounted for when ending, then keeps the record read-only', async () => {
    const user = userEvent.setup();
    renderInProject(<RollCallScreen />);
    await startOne(user);
    await user.click(screen.getByRole('button', { name: 'End roll call' }));
    expect(screen.getByText(/3 people are not yet accounted for/)).toBeTruthy();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'End roll call' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Mark Sam Nguyen' })).toBeNull(),
    );
    expect(screen.getByText('This roll call has ended')).toBeTruthy();
    expect((await attendancePreview.rollCalls('prj_test'))[0]!.endedAt).not.toBeNull();
  });
});

describe('AttendanceScreen', () => {
  it('flags a roll call in progress', async () => {
    await attendancePreview.startRollCall('prj_test', { reason: 'Drill' });
    renderInProject(<AttendanceScreen />);
    expect(await screen.findByText('Roll call in progress')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the roll call' })).toBeTruthy();
  });
});
