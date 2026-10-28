// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import { inductionBuilderSource, resetInductionBuilderPreview } from '../data/source';
import { InductionEditorScreen } from '../screens/InductionEditorScreen';
import { InductionListScreen } from '../screens/InductionListScreen';
import { InductionRegisterScreen } from '../screens/InductionRegisterScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetInductionBuilderPreview();
  nav.search = '';
  nav.pushed = [];
});

async function sampleId() {
  const [first] = await inductionBuilderSource.list('prj_test');
  return first!.id;
}

describe('Induction builder screens (preview data)', () => {
  it('lists the project induction, and offers no second one', async () => {
    renderInProject(<InductionListScreen />);
    expect(await screen.findByRole('link', { name: /site induction/i })).toBeTruthy();
    expect(screen.getByText(/to fix before publishing/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /new induction/i })).toBeNull();
  });

  it('creates the induction when the project has none, then opens the editor', async () => {
    resetInductionBuilderPreview('prj_test');
    const user = userEvent.setup();
    renderInProject(<InductionListScreen />);
    expect(await screen.findByText('No induction for this project yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /new induction/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Tower crane induction');
    await user.click(within(dialog).getByRole('button', { name: 'Create induction' }));
    await waitFor(() => expect(nav.pushed.at(-1)).toMatch(/\/inductions\/ind_/));
  });

  it('keeps approval and publishing behind a saved draft (IND-AC2, AC6)', async () => {
    const user = userEvent.setup();
    renderInProject(<InductionEditorScreen inductionId={await sampleId()} />);
    const publish = await screen.findByRole('button', { name: 'Publish version 1' });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Before you can publish')).toBeTruthy();

    // An edit makes approving wait for a save.
    const ppe = screen.getByRole('region', { name: 'PPE' });
    await user.type(within(ppe).getByLabelText('Text'), ' Gloves for handling.');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Approve PPE' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Approve PPE' }));
    await user.click(screen.getByRole('button', { name: 'Approve Emergencies and first aid' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Publish version 1' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    await user.click(screen.getByRole('button', { name: 'Publish version 1' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/What changed/), 'First version');
    await user.click(within(dialog).getByRole('button', { name: 'Publish version 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('tab', { name: /Versions/ }));
    expect(await screen.findByText(/Version 1 · required today/)).toBeTruthy();
    expect(screen.getByText('First version')).toBeTruthy();
  });

  it('editing an approved section takes its approval back', async () => {
    const user = userEvent.setup();
    renderInProject(<InductionEditorScreen inductionId={await sampleId()} />);
    const ppe = await screen.findByRole('region', { name: 'PPE' });
    await user.click(within(ppe).getByRole('button', { name: 'Approve PPE' }));
    await within(ppe).findByText('Approved');
    await user.type(within(ppe).getByLabelText('Text'), ' More.');
    expect(within(ppe).getByText('Needs approval')).toBeTruthy();
  });

  it('blocks saving while a question is half typed, and adds quiz answers', async () => {
    const user = userEvent.setup();
    renderInProject(<InductionEditorScreen inductionId={await sampleId()} />);
    await user.click(await screen.findByRole('tab', { name: /Quiz/ }));
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    expect(screen.getByText(/Question \d needs a question/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Add answer to question 2' }));
    expect(screen.getAllByLabelText(/^Answer \d$/).length).toBeGreaterThan(2);
  });

  it('shows the register with status and the version completed', async () => {
    renderInProject(<InductionRegisterScreen />);
    expect(await screen.findByText('Sam Worker')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('White card')).toBeTruthy();
  });
});
