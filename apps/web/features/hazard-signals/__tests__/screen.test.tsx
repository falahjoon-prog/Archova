// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { resetHazardPreview } from '../data/source';
import { HazardSignalsScreen } from '../screens/HazardSignalsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetHazardPreview();
  nav.search = '';
});

const photo = (type = 'image/png', size = 10) => {
  const f = new File(['x'], 'site.png', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('HazardSignalsScreen', () => {
  it('scans a photo, shows observations with the disclaimer, then lets a manager confirm one', async () => {
    const user = userEvent.setup();
    renderInProject(<HazardSignalsScreen />);
    const button = screen.getByRole('button', { name: 'Look for hazards' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.upload(screen.getByLabelText('Site photo'), photo());
    await enterText(
      user,
      screen.getByLabelText(/What is this photo of/),
      'Slab edge, no balustrade',
    );
    await user.click(button);
    const list = await screen.findByRole('list', { name: 'Signals from this photo' });
    expect(within(list).getByText('Unprotected edge or opening')).toBeTruthy();
    expect(screen.getByText(/not a safety inspection/)).toBeTruthy();

    cleanup();
    nav.search = 'tab=review';
    renderInProject(<HazardSignalsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/raises no incident/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm hazard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Nothing to review')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmed' }));
    expect(await screen.findByText('Unprotected edge or opening')).toBeTruthy();
  });

  it('refuses a photo Nova cannot read', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderInProject(<HazardSignalsScreen />);
    await user.upload(screen.getByLabelText('Site photo'), photo('application/pdf'));
    expect(screen.getByText('Use a PNG, JPEG or WebP photo.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Look for hazards' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.upload(screen.getByLabelText('Site photo'), photo('image/png', 4 * 1024 * 1024));
    expect(screen.getByText('Use a photo under 3 MB.')).toBeTruthy();
  });

  it('shows an empty patterns table until hazards are confirmed', async () => {
    nav.search = 'tab=patterns';
    renderInProject(<HazardSignalsScreen />);
    expect(await screen.findByText('No patterns yet')).toBeTruthy();
  });
});
