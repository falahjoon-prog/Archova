// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { permitsPreview, resetPermitsPreview } from '../data/source';
import { PermitsScreen } from '../screens/PermitsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetPermitsPreview();
  nav.search = '';
});

describe('PermitsScreen', () => {
  it('lists the register with derived status and shows Nova flags', async () => {
    renderInProject(<PermitsScreen />);
    const table = await screen.findByRole('table', { name: 'Permits and approvals' });
    expect(within(table).getByText('PMT-0001')).toBeTruthy();
    expect(within(table).getByText('Expiring soon')).toBeTruthy();
    expect(within(table).getByText('Expired')).toBeTruthy();
    expect(await screen.findByText(/PMT-0002 .* expired 4 days ago/)).toBeTruthy();
    expect(await screen.findByText(/No occupation certificate on the register/)).toBeTruthy();
  });

  it('adds a permit and refuses an expiry before the issue date', async () => {
    const user = userEvent.setup();
    renderInProject(<PermitsScreen />);
    await screen.findByRole('table', { name: 'Permits and approvals' });
    await user.click(screen.getAllByRole('button', { name: /Add permit/ })[0]!);
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Title'), 'Hot work, level 3');
    await enterText(user, within(dialog).getByLabelText('Issued'), '2026-12-10');
    await enterText(user, within(dialog).getByLabelText('Expires'), '2026-12-01');
    expect(within(dialog).getByText('The expiry date is before the issue date.')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Add permit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Expires'), '2026-12-20');
    await user.click(within(dialog).getByRole('button', { name: 'Add permit' }));
    expect(await screen.findByText('PMT-0004')).toBeTruthy();
  });

  it('starts a renewal, then marks it renewed with a later date', async () => {
    const user = userEvent.setup();
    renderInProject(<PermitsScreen />);
    await screen.findByRole('table', { name: 'Permits and approvals' });
    await user.click(screen.getByRole('button', { name: 'Start renewal PMT-0001' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Renewal in progress')).toBeTruthy(),
    );
    await user.click(screen.getByRole('button', { name: 'Mark renewed PMT-0001' }));
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('New expiry date'), '2027-12-01');
    await user.click(within(dialog).getByRole('button', { name: 'Mark renewed' }));
    await waitFor(async () => {
      const p = (await permitsPreview.list('prj_test', {})).find(
        (x) => x.numberLabel === 'PMT-0001',
      );
      expect(p).toMatchObject({ status: 'active', expiresOn: '2027-12-01' });
    });
  });

  it('saves the suggested expected set', async () => {
    const user = userEvent.setup();
    renderInProject(<PermitsScreen />);
    await screen.findByRole('table', { name: 'Permits and approvals' });
    await user.click(screen.getByRole('button', { name: 'Expected permits' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /suggested set/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await permitsPreview.requirements('prj_test')).map((r) => r.kind).sort()).toEqual([
        'building_permit',
        'construction_certificate',
        'development_approval',
        'occupation_certificate',
      ]),
    );
  });
});
