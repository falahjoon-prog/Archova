// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { resetToolboxPreview, toolboxPreview } from '../data/source';
import { ToolboxScreen } from '../screens/ToolboxScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetToolboxPreview();
  nav.search = '';
});

describe('ToolboxScreen', () => {
  it('lists talks, suggests a topic and starts a talk from the suggestion', async () => {
    const user = userEvent.setup();
    renderInProject(<ToolboxScreen />);
    const table = await screen.findByRole('table', { name: 'Toolbox talks' });
    expect(within(table).getByText('TBT-0001')).toBeTruthy();
    expect(within(table).getByText('1 of 2')).toBeTruthy();
    expect(await screen.findByText('Nova suggests')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start this talk' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Manual handling',
    );
    await enterText(user, within(dialog).getByLabelText('Presented by'), 'Pat Foreman');
    await user.click(within(dialog).getByRole('button', { name: 'Create talk' }));
    await waitFor(async () => expect((await toolboxPreview.listTalks('prj_test')).length).toBe(2));
  });

  it('adds a topic on the Topics tab', async () => {
    const user = userEvent.setup();
    nav.search = 'view=topics';
    renderInProject(<ToolboxScreen />);
    await user.click(await screen.findByRole('button', { name: /Add topic/ }));
    await enterText(
      user,
      within(screen.getByRole('dialog')).getByLabelText('Title'),
      'Heat stress',
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add topic' }));
    expect(await screen.findByText('Heat stress')).toBeTruthy();
  });

  it('keeps Close talk off until everyone has signed or been removed, via the row menu', async () => {
    const user = userEvent.setup();
    nav.search = 'id=tbt_0001';
    renderInProject(<ToolboxScreen />);
    expect(await screen.findByText(/1 person has not signed/)).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close talk' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    // A signed row can't be removed from the menu.
    await user.click(screen.getByRole('button', { name: 'Actions for Sam Carpenter' }));
    expect(
      (screen.getByRole('menuitem', { name: 'Remove from talk' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for Lee Rigger' }));
    expect(screen.getByRole('menuitem', { name: 'Sign…' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Remove from talk' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Close talk' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Close talk' }));
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('opens the signature dialog for a row and needs a signature before Sign is enabled', async () => {
    const user = userEvent.setup();
    nav.search = 'id=tbt_0001';
    renderInProject(<ToolboxScreen />);
    await user.click(await screen.findByRole('button', { name: 'Actions for Lee Rigger' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign…' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign for Lee Rigger' });
    expect(
      (within(dialog).getByRole('button', { name: 'Sign' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
