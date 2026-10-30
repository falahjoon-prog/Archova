// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import { AttendanceScreen } from '../screens/AttendanceScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  nav.search = '';
  nav.pushed = [];
});

describe('AttendanceScreen', () => {
  it('shows who is on site now, by company', async () => {
    renderInProject(<AttendanceScreen />);
    const table = await screen.findByRole('table', { name: 'People on site now' });
    expect(within(table).getByText('Sam Nguyen')).toBeTruthy();
    expect(within(table).queryByText('Liam Ford')).toBeNull();
    const byCompany = screen.getByRole('list', { name: 'On site by company' });
    expect(within(byCompany).getByText('Hunter Concrete (unconfirmed)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'On site now (3)' })).toBeTruthy();
  });

  it("lists the day's records and marks auto-closed hours as approximate", async () => {
    renderInProject(<AttendanceScreen />);
    const table = await screen.findByRole('table', { name: /Sign-in records for/ });
    const row = within(table).getByText('Ben Cole').closest('tr')!;
    expect(within(row).getByText('Closed at day end')).toBeTruthy();
    expect(within(row).getByText('About 10 h 40 min')).toBeTruthy();
    const exact = within(table).getByText('Liam Ford').closest('tr')!;
    expect(within(exact).getByText('8 h 00 min')).toBeTruthy();
  });

  it('filters the day by company', async () => {
    const user = userEvent.setup();
    renderInProject(<AttendanceScreen />);
    await screen.findByRole('table', { name: /Sign-in records for/ });
    await user.selectOptions(screen.getByLabelText('Company'), 'cmp_dry');
    expect(nav.search).toContain('company=cmp_dry');
  });
});
