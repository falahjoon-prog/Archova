// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { inspectionsPreview, resetInspectionsPreview } from '../data/source';
import { InspectionsScreen } from '../screens/InspectionsScreen';
import { TemplatesScreen } from '../screens/TemplatesScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetInspectionsPreview();
  nav.search = '';
  nav.pushed = [];
});

describe('TemplatesScreen', () => {
  it('creates a draft checklist, publishes it, and versions a published one', async () => {
    const user = userEvent.setup();
    renderInProject(<TemplatesScreen />);
    await screen.findByRole('table', { name: 'Checklists' });
    await user.click(screen.getByRole('button', { name: /New checklist/ }));
    const dialog = screen.getByRole('dialog');
    expect(
      (within(dialog).getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Checklist name'), 'Slab check');
    await enterText(user, within(dialog).getByLabelText('Question'), 'Edge formwork set');
    await user.click(within(dialog).getByRole('button', { name: 'Add question' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await user.click(await screen.findByRole('button', { name: 'Publish Slab check' }));
    await waitFor(async () =>
      expect(
        (await inspectionsPreview.templates('prj_test')).find((t) => t.name === 'Slab check')!
          .published,
      ).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'New version of Pre-pour check' }));
    await waitFor(async () =>
      expect(
        (await inspectionsPreview.templates('prj_test')).filter((t) => t.name === 'Pre-pour check'),
      ).toHaveLength(2),
    );
  });
});

describe('InspectionsScreen', () => {
  it('starts an inspection from a published checklist', async () => {
    const user = userEvent.setup();
    renderInProject(<InspectionsScreen />);
    await user.click(await screen.findByRole('button', { name: /Start inspection/ }));
    await user.selectOptions(await screen.findByLabelText('Checklist'), 'itp_pour');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(nav.pushed.some((p) => p.includes('/inspections?id='))).toBe(true));
  });

  it('fills in, saves, signs and closes an inspection', async () => {
    const user = userEvent.setup();
    const d = await inspectionsPreview.start('prj_test', { templateId: 'itp_pour' });
    nav.search = `id=${d.inspection.id}`;
    renderInProject(<InspectionsScreen />);
    await screen.findByText('Reinforcement matches the drawings');
    await user.click(screen.getByRole('button', { name: 'Sign and submit' }));
    expect(within(screen.getByRole('dialog')).getByText(/still need an answer/)).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await user.selectOptions(screen.getByLabelText('Reinforcement matches the drawings'), 'fail');
    await user.selectOptions(screen.getByLabelText('Formwork is clean and braced'), 'yes');
    await enterText(user, screen.getByLabelText('Slump (mm)'), '80');
    await user.selectOptions(screen.getByLabelText('Concrete mix'), 'N32');
    await user.click(screen.getByRole('button', { name: 'Sign and submit' }));
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Your name'), 'Sam Lee');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Signed by Sam Lee/)).toBeTruthy();
    expect(screen.getByText('Failed items')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close inspection' }));
    await waitFor(async () =>
      expect((await inspectionsPreview.get('prj_test', d.inspection.id)).inspection.status).toBe(
        'closed',
      ),
    );
  });
});
