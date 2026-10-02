// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject, enterText } from '@/test/render';
import { DrawingViewerScreen } from '@/features/drawings';
import { resetTakeoffPreview } from '../data/takeoff-source';
import { takeoffViewerExtension } from '../index';
import { totalsByTag } from '../takeoff/TakeoffPanel';
import { geometryOf, toolReducer, type ToolState } from '../takeoff/useTakeoffTool';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const start = (tool: ToolState['tool']): ToolState => ({
  tool,
  points: [],
  outer: null,
  holes: [],
});

describe('takeoff tool reducer', () => {
  it('builds an area with a cut-out, and undo reopens the ring', () => {
    let s = start('area');
    for (const p of [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.1 },
    ])
      s = toolReducer(s, { type: 'add', point: p });
    s = toolReducer(s, { type: 'close-ring' });
    expect(s.outer).toHaveLength(3);
    for (const p of [
      { x: 0.02, y: 0.02 },
      { x: 0.04, y: 0.02 },
      { x: 0.04, y: 0.04 },
    ])
      s = toolReducer(s, { type: 'add', point: p });
    const geo = geometryOf(s);
    expect(geo).toMatchObject({ kind: 'area', holes: [[{}, {}, {}]] });
    s = toolReducer(s, { type: 'undo' });
    expect(s.points).toHaveLength(2);
  });

  it('nudges the last point and keeps it on the sheet', () => {
    let s = toolReducer(start('length'), { type: 'add', point: { x: 0.9995, y: 0.5 } });
    s = toolReducer(s, { type: 'nudge', dx: 0.001, dy: 0 });
    expect(s.points[0]).toEqual({ x: 1, y: 0.5 });
  });

  it('needs two points for a length and one for a count', () => {
    expect(
      geometryOf(toolReducer(start('length'), { type: 'add', point: { x: 0, y: 0 } })),
    ).toBeNull();
    expect(
      geometryOf(toolReducer(start('count'), { type: 'add', point: { x: 0, y: 0 } })),
    ).toMatchObject({ kind: 'count' });
  });
});

describe('totalsByTag', () => {
  it('totals by trade, label and unit', () => {
    const base = { trade: 'Doors and hardware', label: 'Door D1', unit: 'ea' as const };
    const rows = [
      { ...base, quantity: 3 },
      { ...base, quantity: 2 },
      { trade: '', label: 'Wall', unit: 'm' as const, quantity: 4.5 },
    ];
    expect(totalsByTag(rows as never)).toEqual([
      { tag: 'Doors and hardware: Door D1', unit: 'ea', quantity: 5 },
      { tag: 'Wall', unit: 'm', quantity: 4.5 },
    ]);
  });
});

describe('Measure in the drawing viewer (journey 11)', () => {
  beforeEach(() => {
    resetTakeoffPreview();
    nav.search = '';
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
  });

  it('confirms the scale, measures a wall and saves it', async () => {
    const user = userEvent.setup();
    renderInProject(
      <DrawingViewerScreen sheetId="sht_a101" extensions={[takeoffViewerExtension]} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Measure' }));

    // Rev B measurements are offered for re-check, never moved (EST-AC10).
    expect(await screen.findByText(/3 measurements were made on Rev B/)).toBeTruthy();

    // Tools are disabled until the detected scale is confirmed (EST-AC8).
    expect((screen.getByRole('button', { name: 'Length' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Confirm 1:100' }));
    expect(await screen.findByText(/confirmed by Test User/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Length' }));
    await enterText(user, screen.getByLabelText('Label'), 'Grid A wall');
    const canvas = screen.getByRole('application');
    // 84.1 px = 84.1 mm on an A1 sheet = 8.41 m at 1:100 (points away from walls, so no snapping).
    await user.pointer([
      { target: canvas, coords: { clientX: 100, clientY: 320 }, keys: '[MouseLeft]' },
      { target: canvas, coords: { clientX: 184.1, clientY: 320 }, keys: '[MouseLeft]' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText('Not saved yet (1)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save measurements' }));

    const quantities = await screen.findByRole('table', { name: 'Totals by tag and unit' });
    expect(within(quantities).getByText('8.41 m')).toBeTruthy();
    vi.restoreAllMocks();
  });
});
