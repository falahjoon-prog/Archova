// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { attendancePreview, resetWorkerPreview } from '../data/source';
import { WorkersScreen } from '../screens/WorkersScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetWorkerPreview();
  nav.search = '';
});

describe('WorkersScreen', () => {
  it('lists workers and flags a company typed at the gate', async () => {
    renderInProject(<WorkersScreen />);
    const jo = (await screen.findByRole('rowheader', { name: /Jo Tran/ })).closest('tr')!;
    expect(within(jo).getByText('Hunter Concrete')).toBeTruthy();
    expect(within(jo).getByText('Not confirmed')).toBeTruthy();
    const sam = screen.getByRole('rowheader', { name: /Sam Nguyen/ }).closest('tr')!;
    expect(within(sam).queryByText('Not confirmed')).toBeNull();
  });

  it('confirms a gate-typed company by picking one from the directory', async () => {
    const user = userEvent.setup();
    renderInProject(<WorkersScreen />);
    await user.click(await screen.findByRole('button', { name: /Confirm company.*Jo Tran/ }));
    expect(screen.getByText(/They typed “Hunter Concrete” at the gate/)).toBeTruthy();
    await user.selectOptions(
      within(screen.getByRole('dialog')).getByLabelText('Company'),
      'cmp_elec',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const jo = (await attendancePreview.workers('prj_test', {})).find((w) => w.id === 'wkr_2')!;
      expect(jo.companyId).toBe('cmp_elec');
      expect(jo.companyNameOther).toBeNull();
    });
  });

  it('adds a worker', async () => {
    const user = userEvent.setup();
    renderInProject(<WorkersScreen />);
    await user.click(await screen.findByRole('button', { name: /Add worker/ }));
    await enterText(user, screen.getByLabelText('Full name'), 'Ana Silva');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await attendancePreview.workers('prj_test', {})).map((w) => w.fullName)).toContain(
        'Ana Silva',
      ),
    );
  });

  it('switches sign-in access off', async () => {
    const user = userEvent.setup();
    renderInProject(<WorkersScreen />);
    await user.click(await screen.findByRole('button', { name: /Switch off.*Sam Nguyen/ }));
    await waitFor(async () =>
      expect(
        (await attendancePreview.workers('prj_test', {})).find((w) => w.id === 'wkr_1')!.status,
      ).toBe('inactive'),
    );
  });
});
