// A person's own arrangement of the Tools tab: which tools show and in what order. Kept on the phone, per person.
import type { ToolDef, ToolId } from './tools';

export interface ToolLayout {
  /** Every tool id, in the order the person wants. */
  order: ToolId[];
  hidden: ToolId[];
}

export const defaultLayout = (tools: readonly ToolDef[]): ToolLayout => ({
  order: tools.map((t) => t.id),
  hidden: [],
});

/**
 * Makes a saved layout fit today's tool list: tools that no longer exist are dropped, new ones go at the end, and
 * nothing repeats.
 */
export function reconcile(
  tools: readonly ToolDef[],
  saved: Partial<ToolLayout> | null,
): ToolLayout {
  const known = new Set<ToolId>(tools.map((t) => t.id));
  const order: ToolId[] = [];
  for (const id of saved?.order ?? []) if (known.has(id) && !order.includes(id)) order.push(id);
  for (const t of tools) if (!order.includes(t.id)) order.push(t.id);
  const hidden = (saved?.hidden ?? []).filter(
    (id, i, all) => known.has(id) && all.indexOf(id) === i,
  );
  return { order, hidden };
}

/** The tools to show, in order. */
export function visibleTools(tools: readonly ToolDef[], layout: ToolLayout): ToolDef[] {
  const byId = new Map(tools.map((t) => [t.id, t]));
  return layout.order
    .filter((id) => !layout.hidden.includes(id))
    .flatMap((id) => {
      const tool = byId.get(id);
      return tool ? [tool] : [];
    });
}

/** Moves a tool one place earlier (`-1`) or later (`1`); the ends stay put. */
export function moveTool(layout: ToolLayout, id: ToolId, step: -1 | 1): ToolLayout {
  const from = layout.order.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { ...layout, order };
}

/** Shows or hides a tool. */
export function setHidden(layout: ToolLayout, id: ToolId, hidden: boolean): ToolLayout {
  const rest = layout.hidden.filter((h) => h !== id);
  return { ...layout, hidden: hidden ? [...rest, id] : rest };
}

export interface LayoutBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

const keyFor = (userId: string) => `archova.tools_layout.${userId}`;

export async function loadLayout(
  backend: LayoutBackend,
  userId: string,
  tools: readonly ToolDef[],
): Promise<ToolLayout> {
  try {
    const raw = await backend.getItemAsync(keyFor(userId));
    return reconcile(tools, raw ? (JSON.parse(raw) as Partial<ToolLayout>) : null);
  } catch {
    return defaultLayout(tools);
  }
}

export async function saveLayout(
  backend: LayoutBackend,
  userId: string,
  layout: ToolLayout,
): Promise<void> {
  try {
    await backend.setItemAsync(keyFor(userId), JSON.stringify(layout));
  } catch {
    // The arrangement is a convenience; if it can't be saved the person simply sees the default next time.
  }
}
