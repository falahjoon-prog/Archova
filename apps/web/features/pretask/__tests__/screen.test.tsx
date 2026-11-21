// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { pretaskPreview, resetPretaskPreview } from '../data/source';
import { PretaskScreen } from '../screens/PretaskScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetPretaskPreview();
  nav.search = '';
});

describe('PretaskScreen', () => {
  it('lists plans and starts one with a hazard, its controls and a crew', async () => {
    const user = userEvent.setup();
    renderInProject(<PretaskScreen />);
    const table = await screen.findByRole('table', { name: 'Pre-task plans' });
    expect(within(table).getByText('PTP-0001')).toBeTruthy();
    expect(within(table).getByText('1 of 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /New plan/ }));
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Task'), 'Pour slab');
    await enterText(user, within(dialog).getByLabelText('Supervisor'), 'Pat Foreman');
    await enterText(
      user,
      within(dialog).getByLabelText('What could go wrong'),
      'Wet concrete burns',
    );
    await enterText(
      user,
      within(dialog).getByLabelText('How we will control it'),
      'Gloves and wash station',
    );
    await enterText(user, within(dialog).getByLabelText(/Who is doing the task/), 'Sam Carpenter');
    await user.click(within(dialog).getByRole('button', { name: 'Start plan' }));
    await waitFor(async () => expect((await pretaskPreview.listPlans('prj_test')).length).toBe(2));
    const created = (await pretaskPreview.listPlans('prj_test'))[0]!;
    expect(created.hazards[0]).toMatchObject({
      hazard: 'Wet concrete burns',
      controls: 'Gloves and wash station',
    });
    expect(created.crewCount).toBe(1);
  });

  it('keeps Close plan off until everyone has signed or been removed, via the row menu', async () => {
    const user = userEvent.setup();
    nav.search = 'id=ptk_0001';
    renderInProject(<PretaskScreen />);
    expect(await screen.findByText(/1 person has not signed on/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Close plan' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // A signed person can't be removed from the menu.
    await user.click(screen.getByRole('button', { name: 'Actions for Sam Carpenter' }));
    expect(
      (screen.getByRole('menuitem', { name: 'Remove from plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for Lee Rigger' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from plan' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Close plan' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Close plan' }));
    // A closed plan waits for the supervisor, who reviews it.
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reviewed' }),
    );
    expect(await screen.findByText('Reviewed by supervisor')).toBeTruthy();
  });

  it('needs a signature before Sign on is enabled', async () => {
    const user = userEvent.setup();
    nav.search = 'id=ptk_0001';
    renderInProject(<PretaskScreen />);
    await user.click(await screen.findByRole('button', { name: 'Actions for Lee Rigger' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign on…' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign on for Lee Rigger' });
    expect(
      (within(dialog).getByRole('button', { name: 'Sign on' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('starts a plan from a template and shows the insights tab', async () => {
    const user = userEvent.setup();
    renderInProject(<PretaskScreen />);
    await screen.findByRole('table', { name: 'Pre-task plans' });
    await user.click(screen.getByRole('button', { name: /New plan/ }));
    const dialog = screen.getByRole('dialog');
    const picker = await within(dialog).findByLabelText('Start from a template');
    await user.selectOptions(picker, 'ptt_0001');
    const task = within(dialog).getByLabelText('Task') as HTMLInputElement;
    await waitFor(() => expect(task.value).not.toBe(''));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    cleanup();
    nav.search = 'view=insights';
    renderInProject(<PretaskScreen />);
    expect(await screen.findByRole('table', { name: 'Hazards that keep coming up' })).toBeTruthy();
  });

  it('copies a plan from its detail view', async () => {
    const user = userEvent.setup();
    nav.search = 'id=ptk_0001';
    renderInProject(<PretaskScreen />);
    await user.click(await screen.findByRole('button', { name: 'Copy to today' }));
    await waitFor(async () => expect((await pretaskPreview.listPlans('prj_test')).length).toBe(2));
  });
});
