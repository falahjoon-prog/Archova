// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { insurancePreview, resetInsurancePreview } from '../data/source';
import { InsuranceScreen } from '../screens/InsuranceScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetInsurancePreview();
  nav.search = '';
});

const TABLE = 'Insurance and bonds';

describe('InsuranceScreen', () => {
  it('lists the register with derived status and shows Nova flags', async () => {
    renderInProject(<InsuranceScreen />);
    const table = await screen.findByRole('table', { name: TABLE });
    expect(within(table).getByText('INS-0001')).toBeTruthy();
    expect(within(table).getByText('Expiring soon')).toBeTruthy();
    expect(within(table).getByText('Expired')).toBeTruthy();
    expect(await screen.findByText(/INS-0003 .* expired \d+ days? ago/)).toBeTruthy();
    expect(await screen.findByText(/Bayside Hydraulics: No workers' compensation/)).toBeTruthy();
    expect(await screen.findByText(/Public liability insurance is \$10,000,000/)).toBeTruthy();
  });

  it('adds a certificate and refuses an expiry before the issue date', async () => {
    const user = userEvent.setup();
    renderInProject(<InsuranceScreen />);
    await screen.findByRole('table', { name: TABLE });
    await user.click(screen.getAllByRole('button', { name: /Add certificate or bond/ })[0]!);
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Title'), 'Ironbark public liability');
    await user.selectOptions(within(dialog).getByLabelText('Company'), 'cmp_tile');
    await enterText(user, within(dialog).getByLabelText('Issued'), '2026-12-10');
    await enterText(user, within(dialog).getByLabelText('Expires'), '2026-12-01');
    expect(within(dialog).getByText('The expiry date is before the issue date.')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Add to register' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Expires'), '2026-12-20');
    await user.click(within(dialog).getByRole('button', { name: 'Add to register' }));
    expect(await screen.findByText('INS-0005')).toBeTruthy();
  });

  it('starts a renewal, then marks it renewed with a later date', async () => {
    const user = userEvent.setup();
    renderInProject(<InsuranceScreen />);
    await screen.findByRole('table', { name: TABLE });
    await user.click(screen.getByRole('button', { name: 'Start renewal INS-0001' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Renewal in progress')).toBeTruthy(),
    );
    await user.click(screen.getByRole('button', { name: 'Mark renewed INS-0001' }));
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('New expiry date'), '2027-12-01');
    await user.click(within(dialog).getByRole('button', { name: 'Mark renewed' }));
    await waitFor(async () => {
      const p = (await insurancePreview.list('prj_test', {})).find(
        (x) => x.numberLabel === 'INS-0001',
      );
      expect(p).toMatchObject({ status: 'active', expiresOn: '2027-12-01' });
    });
  });

  it('saves the suggested required set', async () => {
    const user = userEvent.setup();
    renderInProject(<InsuranceScreen />);
    await screen.findByRole('table', { name: TABLE });
    await user.click(screen.getByRole('button', { name: 'Required cover' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /suggested set/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await insurancePreview.requirements('prj_test')).map((r) => r.kind).sort()).toEqual([
        'contract_works',
        'public_liability',
        'workers_comp',
      ]),
    );
  });
});
