// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { resetGeotechPreview, summarise } from '../data/source';
import { GeotechScreen } from '../screens/GeotechScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetGeotechPreview();
  nav.search = '';
});

describe('GeotechScreen', () => {
  it('lists investigations with report status and shows Nova flags', async () => {
    renderInProject(<GeotechScreen />);
    const table = await screen.findByRole('table', { name: 'Site investigations' });
    expect(within(table).getByText('GEO-0001')).toBeTruthy();
    expect(within(table).getByText('Attached')).toBeTruthy();
    expect(within(table).getByText('Missing')).toBeTruthy();
    expect(await screen.findByText(/CBR|FIELD_DENSITY_RATIO test outside its limits/)).toBeTruthy();
    expect(await screen.findByText('Lot B is short of fill')).toBeTruthy();
    expect(await screen.findByText('GEO-0002 has no log or report attached')).toBeTruthy();
  });

  it('shows test outcomes from the typed limits', async () => {
    nav.search = 'tab=tests';
    renderInProject(<GeotechScreen />);
    const table = await screen.findByRole('table', { name: 'Test results' });
    expect(within(table).getByText('Within limits')).toBeTruthy();
    expect(within(table).getByText('Outside limits')).toBeTruthy();
  });

  it('adds a test result and judges it against the limits', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=tests';
    renderInProject(<GeotechScreen />);
    await screen.findByRole('table', { name: 'Test results' });
    await user.click(screen.getAllByRole('button', { name: /Add test result/ })[0]!);
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText(/^Result/), '3');
    await enterText(user, within(dialog).getByLabelText('Minimum allowed'), '10');
    await enterText(user, within(dialog).getByLabelText('Maximum allowed'), '5');
    expect(within(dialog).getByText('The minimum is above the maximum.')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Add test result' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Maximum allowed'), '');
    await user.click(within(dialog).getByRole('button', { name: 'Add test result' }));
    await waitFor(() => expect(screen.getAllByText('Outside limits')).toHaveLength(2));
  });

  it('adds a volume and shows the balance by zone', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=earthworks';
    renderInProject(<GeotechScreen />);
    const balance = await screen.findByRole('table', { name: 'Earthworks balance by zone' });
    expect(within(balance).getByText('-300')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /Add volume/ })[0]!);
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Zone'), 'Lot B');
    await enterText(user, within(dialog).getByLabelText('Volume (m³)'), '0');
    expect(
      (within(dialog).getByRole('button', { name: 'Add volume' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Volume (m³)'), '300');
    await user.click(within(dialog).getByRole('button', { name: 'Add volume' }));
    await waitFor(() => {
      const row = within(screen.getByRole('table', { name: 'Earthworks balance by zone' }))
        .getByText('Lot B')
        .closest('tr')!;
      expect(within(row).getByText('0', { selector: 'span' }).textContent).toBe('0');
      expect(row.textContent).toContain('700');
    });
  });
});

describe('summarise (preview mirrors the server)', () => {
  it('balances cut + imported - fill - exported', () => {
    const e = (zone: string, kind: 'cut' | 'fill' | 'import' | 'export', volumeM3: number) =>
      ({
        id: zone + kind,
        projectId: 'p',
        zone,
        kind,
        volumeM3,
        material: null,
        recordedOn: '2026-11-01',
        notes: null,
        createdAt: '',
      }) as never;
    const s = summarise([
      e('A', 'cut', 10),
      e('A', 'import', 5),
      e('A', 'fill', 8),
      e('A', 'export', 1),
    ]);
    expect(s.zones[0]!.balance).toBe(6);
  });
});
