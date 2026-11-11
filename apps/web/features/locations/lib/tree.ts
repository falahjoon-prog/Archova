import type { LocationTreeKind, LocationTreeNode } from '../data/api';

export const KIND_LABELS: Record<LocationTreeKind, string> = {
  site: 'Site',
  building: 'Building',
  wing: 'Wing',
  level: 'Level',
  zone: 'Zone',
  room: 'Room',
  area: 'Area',
  external: 'External',
};

export interface LocationNode {
  location: LocationTreeNode;
  children: LocationNode[];
}

/** Rows (any order) into a tree; a row whose parent is missing from the list sits at the top. */
export function buildTree(rows: readonly LocationTreeNode[]): LocationNode[] {
  const nodes = new Map<string, LocationNode>(
    rows.map((l) => [l.id, { location: l, children: [] }]),
  );
  const roots: LocationNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.location.parentId ? nodes.get(n.location.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const byOrder = (a: LocationNode, b: LocationNode) =>
    a.location.sort - b.location.sort || a.location.name.localeCompare(b.location.name);
  const sort = (list: LocationNode[]) => {
    list.sort(byOrder);
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** Depth-first, each row with how deep it sits, ready to render as an indented list. */
export function flatten(
  rows: readonly LocationTreeNode[],
): Array<{ location: LocationTreeNode; depth: number }> {
  const out: Array<{ location: LocationTreeNode; depth: number }> = [];
  const walk = (list: LocationNode[], depth: number) => {
    for (const n of list) {
      out.push({ location: n.location, depth });
      walk(n.children, depth + 1);
    }
  };
  walk(buildTree(rows), 0);
  return out;
}

/** Ids of a location and everything inside it, so a move can never offer a place inside itself. */
export function descendantIds(rows: readonly LocationTreeNode[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of rows)
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
  }
  return out;
}

/** The deepest nesting the server accepts (MAX_LOCATION_DEPTH). */
export const MAX_DEPTH = 8;
