// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import { resetDrawingsPreview } from '../data/source';
import { DrawingRegisterScreen } from '../screens/DrawingRegisterScreen';
import { DrawingViewerScreen } from '../screens/DrawingViewerScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetDrawingsPreview();
  nav.search = '';
  nav.pushed = [];
});

describe('DrawingRegisterScreen', () => {
  it('lists current revisions with links into the viewer', async () => {
    renderInProject(<DrawingRegisterScreen />);
    const link = await screen.findByRole('link', { name: 'A-101' });
    expect(link.getAttribute('href')).toBe('/acme/projects/prj_test/drawings/sht_a101');
    const row = link.closest('tr')!;
    expect(within(row).getByText('Rev C (current)')).toBeTruthy();
  });
});

describe('DrawingViewerScreen', () => {
  it('opens the current revision with its pinned items', async () => {
    renderInProject(<DrawingViewerScreen sheetId="sht_a101" />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ground floor plan' }),
    ).toBeTruthy();
    expect(screen.getAllByText('Rev C (current)').length).toBeGreaterThan(0);
    expect(screen.queryByText(/is superseded/)).toBeNull();
    const rfi = await screen.findByRole('link', { name: 'RFI-003' });
    expect(rfi.getAttribute('href')).toBe('/acme/projects/prj_test/rfis/rfi_003');
    expect(screen.getByText('Check location')).toBeTruthy();
  });

  it('always shows the superseded banner on an old revision (DOC-AC6)', async () => {
    nav.search = 'rev=rev_a101_b';
    renderInProject(<DrawingViewerScreen sheetId="sht_a101" />);
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Rev B is superseded');
    expect(banner.textContent).toContain('Superseded by Rev C on');
    expect(within(banner).getByRole('link', { name: 'View current' }).getAttribute('href')).toBe(
      '/acme/projects/prj_test/drawings/sht_a101?rev=rev_a101_c',
    );
    expect(within(banner).queryByRole('button')).toBeNull();
  });

  it('asks for confirmation before publishing a markup to the project (DOC-AC7)', async () => {
    const user = userEvent.setup();
    // jsdom has no layout: give the sheet a size so pointer positions map to sheet coordinates.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 841,
      height: 594,
      right: 841,
      bottom: 594,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    renderInProject(<DrawingViewerScreen sheetId="sht_a101" />);
    await screen.findByRole('heading', { level: 1 });
    // Draw a rectangle: pick the tool, then two clicks on the canvas.
    await user.click(screen.getByRole('button', { name: 'Rectangle markup' }));
    const canvas = screen.getByRole('application');
    await user.pointer([
      { target: canvas, keys: '[MouseLeft]' },
      { target: canvas, keys: '[MouseLeft]' },
    ]);
    const publish = await screen.findByRole('button', { name: 'Publish to project' });
    await user.click(publish);
    expect(await screen.findByText('Publish this markup to the project?')).toBeTruthy();
    vi.restoreAllMocks();
  });
});
