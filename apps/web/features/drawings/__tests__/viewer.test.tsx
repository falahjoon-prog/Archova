// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
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
    await user.click(screen.getByRole('button', { name: 'Box' }));
    const canvas = screen.getByRole('application');
    await user.pointer([
      { target: canvas, keys: '[MouseLeft]', coords: { clientX: 100, clientY: 100 } },
      { target: canvas, keys: '[MouseLeft]', coords: { clientX: 400, clientY: 300 } },
    ]);
    const publish = await screen.findByRole('button', { name: 'Publish to project' });
    await user.click(publish);
    expect(await screen.findByText('Publish this markup to the project?')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('draws a freehand stroke by dragging, in the chosen colour', async () => {
    const user = userEvent.setup();
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
    const { container } = renderInProject(<DrawingViewerScreen sheetId="sht_a101" />);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Pen' }));
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    const canvas = screen.getByRole('application');
    await user.pointer([
      { target: canvas, keys: '[MouseLeft>]', coords: { clientX: 100, clientY: 100 } },
      { target: canvas, coords: { clientX: 200, clientY: 160 } },
      { target: canvas, coords: { clientX: 300, clientY: 140 } },
      { target: canvas, keys: '[/MouseLeft]', coords: { clientX: 400, clientY: 220 } },
    ]);
    // The stroke is saved as one markup, listed in the side panel, and drawn in blue.
    await waitFor(() =>
      expect(
        container.querySelector('[data-layer="markups"] polyline')?.getAttribute('stroke'),
      ).toBe('#1D4ED8'),
    );
    vi.restoreAllMocks();
  });

  it('keeps a click without a drag from leaving a stray mark', async () => {
    const user = userEvent.setup();
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
    const { container } = renderInProject(<DrawingViewerScreen sheetId="sht_a101" />);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Pen' }));
    await user.pointer({
      target: screen.getByRole('application'),
      keys: '[MouseLeft]',
      coords: { clientX: 100, clientY: 100 },
    });
    expect(container.querySelector('[data-layer="markups"] polyline')).toBeNull();
    vi.restoreAllMocks();
  });
});
