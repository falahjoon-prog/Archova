// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { actionPlansPreview, resetActionPlansPreview } from '../data/source';
import { ActionPlansScreen } from '../screens/ActionPlansScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetActionPlansPreview();
  nav.search = '';
});

describe('ActionPlansScreen', () => {
  it('lists plans with progress and filters by status', async () => {
    const first = renderInProject(<ActionPlansScreen />);
    const table = await screen.findByRole('table', { name: 'Action plans' });
    expect(within(table).getByText('AP-0001')).toBeTruthy();
    expect(within(table).getByText('1 of 3')).toBeTruthy();
    expect(within(table).getByText(/Overdue/)).toBeTruthy();
    first.unmount();
    nav.search = 'status=completed';
    renderInProject(<ActionPlansScreen />);
    expect(await screen.findByText('AP-0002')).toBeTruthy();
    expect(screen.queryByText('AP-0001')).toBeNull();
  });

  it('creates a plan from a template with its steps', async () => {
    const user = userEvent.setup();
    renderInProject(<ActionPlansScreen />);
    await user.click(await screen.findByRole('button', { name: /New action plan/ }));
    expect(
      (screen.getByRole('button', { name: 'Create plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await enterText(user, screen.getByLabelText('Title'), 'Level 3 pour');
    await user.selectOptions(await screen.findByLabelText('Start from a template'), 'apt_0001');
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    await waitFor(async () => {
      const plans = await actionPlansPreview.list('prj_test', {});
      expect(plans.find((p) => p.title === 'Level 3 pour')).toMatchObject({
        numberLabel: 'AP-0003',
        itemCount: 3,
      });
    });
  });

  it('creates a plan from typed steps, one per line', async () => {
    const user = userEvent.setup();
    renderInProject(<ActionPlansScreen />);
    await user.click(await screen.findByRole('button', { name: /New action plan/ }));
    await enterText(user, screen.getByLabelText('Title'), 'Handover');
    await enterText(user, screen.getByLabelText(/Steps, one per line/), 'Clean\n\nWalk through');
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    await waitFor(async () => {
      const plans = await actionPlansPreview.list('prj_test', {});
      expect(plans.find((p) => p.title === 'Handover')?.itemCount).toBe(2);
    });
  });
});

describe('ActionPlanDetailView', () => {
  it('marks a step done, completes the plan on the last step and reopens it', async () => {
    const user = userEvent.setup();
    nav.search = 'id=apl_0001';
    renderInProject(<ActionPlansScreen />);
    expect(await screen.findByText('1 of 3 steps done')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Skip: Install edge protection' }));
    await user.click(await screen.findByRole('button', { name: 'Mark done: Builder sign-off' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText('3 of 3 steps done')).toBeTruthy();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Reopen: Builder sign-off' }));
    expect(await screen.findByText('2 of 3 steps done')).toBeTruthy();
  });

  it('adds a step and cancels the plan, after which steps can no longer change', async () => {
    const user = userEvent.setup();
    nav.search = 'id=apl_0001';
    renderInProject(<ActionPlansScreen />);
    await user.click(await screen.findByRole('button', { name: /Add step/ }));
    await enterText(user, screen.getByLabelText('Step'), 'Photograph the fix');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add step' }));
    expect(await screen.findByText('Photograph the fix')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Cancel plan/ }));
    expect(await screen.findByRole('button', { name: /Reopen plan/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mark done:/ })).toBeNull();
  });

  it('saves the plan as a template', async () => {
    const user = userEvent.setup();
    nav.search = 'id=apl_0001';
    renderInProject(<ActionPlansScreen />);
    await user.click(await screen.findByRole('button', { name: /Save as template/ }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(async () =>
      expect((await actionPlansPreview.templates('prj_test')).map((t) => t.name)).toContain(
        'Level 2 edge protection',
      ),
    );
  });
});
