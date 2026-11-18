import { describe, expect, it } from 'vitest';
import {
  defaultLayout,
  loadLayout,
  moveTool,
  reconcile,
  saveLayout,
  setHidden,
  visibleTools,
  type LayoutBackend,
} from '../lib/tool-layout';
import { TOOLS } from '../lib/tools';

const memory = (): LayoutBackend & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => void data.set(k, v),
  };
};

describe('tool layout', () => {
  it('starts with every tool in the catalogue order', () => {
    const layout = defaultLayout(TOOLS);
    expect(visibleTools(TOOLS, layout).map((t) => t.id)).toEqual(TOOLS.map((t) => t.id));
  });

  it('moves a tool earlier or later and stops at the ends', () => {
    const start = defaultLayout(TOOLS);
    const second = start.order[1]!;
    expect(moveTool(start, second, -1).order[0]).toBe(second);
    expect(moveTool(start, start.order[0]!, -1)).toBe(start);
    const last = start.order[start.order.length - 1]!;
    expect(moveTool(start, last, 1)).toBe(start);
    expect(moveTool(start, second, 1).order[2]).toBe(second);
  });

  it('hides and shows a tool without losing its place', () => {
    const start = defaultLayout(TOOLS);
    const id = start.order[3]!;
    const hidden = setHidden(start, id, true);
    expect(visibleTools(TOOLS, hidden).map((t) => t.id)).not.toContain(id);
    expect(hidden.order).toEqual(start.order);
    expect(setHidden(hidden, id, false).hidden).toEqual([]);
  });

  it('fits a saved layout to the current tools', () => {
    const ids = TOOLS.map((t) => t.id);
    const saved = {
      order: ['nope' as never, ids[2]!, ids[2]!, ids[0]!],
      hidden: ['gone' as never, ids[1]!],
    };
    const layout = reconcile(TOOLS, saved);
    expect(layout.order.slice(0, 2)).toEqual([ids[2], ids[0]]);
    expect(layout.order).toHaveLength(ids.length);
    expect(layout.hidden).toEqual([ids[1]]);
  });

  it('saves per person and falls back to the default when nothing or junk is saved', async () => {
    const backend = memory();
    const mine = moveTool(defaultLayout(TOOLS), TOOLS[1]!.id, -1);
    await saveLayout(backend, 'usr_a', mine);
    expect((await loadLayout(backend, 'usr_a', TOOLS)).order).toEqual(mine.order);
    expect((await loadLayout(backend, 'usr_b', TOOLS)).order).toEqual(defaultLayout(TOOLS).order);
    backend.data.set('archova.tools_layout.usr_c', '{not json');
    expect((await loadLayout(backend, 'usr_c', TOOLS)).order).toEqual(defaultLayout(TOOLS).order);
  });
});
