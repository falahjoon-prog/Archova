// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { observationsPreview, resetObservationsPreview } from '../data/source';
import { ObservationsScreen } from '../screens/ObservationsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetObservationsPreview();
  nav.search = '';
});

describe('ObservationsScreen', () => {
  it('lists observations and filters by status', async () => {
    const first = renderInProject(<ObservationsScreen />);
    const table = await screen.findByRole('table', { name: 'Observations' });
    expect(within(table).getByText('OBS-0001')).toBeTruthy();
    expect(within(table).getByText(/Overdue/)).toBeTruthy();
    first.unmount();
    nav.search = 'status=closed';
    renderInProject(<ObservationsScreen />);
    expect(await screen.findByText('OBS-0003')).toBeTruthy();
    expect(screen.queryByText('OBS-0001')).toBeNull();
  });

  it('raises an observation, numbered in order', async () => {
    const user = userEvent.setup();
    renderInProject(<ObservationsScreen />);
    await user.click(await screen.findByRole('button', { name: /New observation/ }));
    expect(
      (screen.getByRole('button', { name: 'Raise observation' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await enterText(user, screen.getByLabelText('What did you see?'), 'Open trench, no barrier');
    await user.click(screen.getByRole('button', { name: 'Raise observation' }));
    expect(await screen.findByText('OBS-0004')).toBeTruthy();
  });

  it('resolves, closes, and needs a reason to reopen', async () => {
    const user = userEvent.setup();
    renderInProject(<ObservationsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Mark resolved OBS-0001' }));
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    await waitFor(async () =>
      expect(
        (await observationsPreview.list('prj_test', {})).find((o) => o.id === 'obs_0001')!.status,
      ).toBe('resolved'),
    );
    await user.click(await screen.findByRole('button', { name: 'Reopen OBS-0001' }));
    expect((screen.getByRole('button', { name: 'Reopen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await enterText(user, screen.getByLabelText('Reason'), 'Fix did not hold');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(async () =>
      expect(
        (await observationsPreview.list('prj_test', {})).find((o) => o.id === 'obs_0001')!.status,
      ).toBe('open'),
    );
  });
});
