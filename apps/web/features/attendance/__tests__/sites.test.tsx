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

  it('sets a custom boundary, validates it, and can go back to the project location', async () => {
    const user = userEvent.setup();
    renderInProject(<SitesScreen />);
    expect(await screen.findByText(/Boundary from the project location/)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /Edit.*Main site/ }));
    await user.click(screen.getByRole('switch', { name: 'Use a custom boundary for this site' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await enterText(user, screen.getByLabelText('Latitude'), '-33.86882');
    await enterText(user, screen.getByLabelText('Longitude'), '151.20929');
    await user.clear(screen.getByLabelText('Radius (metres)'));
    await enterText(user, screen.getByLabelText('Radius (metres)'), '5');
    expect(screen.getByText('Enter a whole number from 10 to 10000.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    await user.clear(screen.getByLabelText('Radius (metres)'));
    await enterText(user, screen.getByLabelText('Radius (metres)'), '150');
    await user.click(save);
    expect(await screen.findByText(/Boundary 150 m around -33.86882, 151.20929/)).toBeTruthy();
    expect((await attendancePreview.sites('prj_test'))[0]!.boundary).toEqual({
      lat: -33.86882,
      lng: 151.20929,
      radiusM: 150,
    });
    await user.click(screen.getByRole('button', { name: /Edit.*Main site/ }));
    await user.click(screen.getByRole('switch', { name: 'Use a custom boundary for this site' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Boundary from the project location/)).toBeTruthy();
  });
});
