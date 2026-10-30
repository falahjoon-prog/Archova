// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { attendancePreview, resetAttendancePreview } from '../data/source';
import { gateQrSvg } from '../components/GateQr';
import { SitesScreen } from '../screens/SitesScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetAttendancePreview();
  nav.search = '';
});

describe('SitesScreen', () => {
  it('lists sites with their gates', async () => {
    renderInProject(<SitesScreen />);
    const table = await screen.findByRole('table', { name: 'Gates at Main site' });
    expect(within(table).getByRole('rowheader', { name: 'Front gate' })).toBeTruthy();
    const hoist = within(table).getByRole('rowheader', { name: 'Level 3 hoist' }).closest('tr')!;
    expect(within(hoist).getByText('Closed')).toBeTruthy();
    expect(screen.getByText(/Open sign-ins close at 7:00 pm/)).toBeTruthy();
  });

  it('adds a gate and shows its QR code once', async () => {
    const user = userEvent.setup();
    renderInProject(<SitesScreen />);
    await user.click(await screen.findByRole('button', { name: /Add gate/ }));
    await enterText(user, screen.getByLabelText('Gate name'), 'Rear gate');
    await user.click(screen.getByRole('button', { name: 'Add gate' }));
    expect(await screen.findByRole('img', { name: 'QR code for Rear gate' })).toBeTruthy();
    expect(screen.getByText(/This code is shown once/)).toBeTruthy();
    const sites = await attendancePreview.sites('prj_test');
    expect(sites[0]!.gates.map((g) => g.name)).toContain('Rear gate');
  });

  it('warns before issuing a new code and bumps its version', async () => {
    const user = userEvent.setup();
    renderInProject(<SitesScreen />);
    await user.click(await screen.findByRole('button', { name: /New code.*Front gate/ }));
    expect(screen.getByText(/The old code stops working straight away/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Issue new code' }));
    expect(await screen.findByRole('img', { name: 'QR code for Front gate' })).toBeTruthy();
    const front = (await attendancePreview.sites('prj_test'))[0]!.gates[0]!;
    expect(front.qrVersion).toBe(2);
  });

  it('closes a gate and saves site settings', async () => {
    const user = userEvent.setup();
    renderInProject(<SitesScreen />);
    await user.click(await screen.findByRole('button', { name: /Close.*Front gate/ }));
    await waitFor(async () =>
      expect((await attendancePreview.sites('prj_test'))[0]!.gates[0]!.active).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: /Edit.*Main site/ }));
    await user.selectOptions(
      screen.getByLabelText('When a worker fails the induction check'),
      'warn',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await attendancePreview.sites('prj_test'))[0]!.gateCheckMode).toBe('warn'),
    );
  });
});

describe('gateQrSvg', () => {
  it('draws an svg for a gate code', () => {
    expect(gateQrSvg('gqr_abcdefghijklmnop')).toMatch(/^<svg /);
  });
});
