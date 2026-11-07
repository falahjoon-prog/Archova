import { describe, expect, it } from 'vitest';
import type { ProjectLocation } from '../data/api';
import { buildTree, descendantIds, flatten } from '../lib/tree';

let n = 0;
const loc = (name: string, parentId: string | null, sort = 0): ProjectLocation => {
  const id = `loc_${String(++n).padStart(26, '0')}`;
  return {
    id,
    projectId: 'prj_1',
    parentId,
    kind: 'area',
    name,
    code: null,
    path: name,
    depth: 1,
    sort,
    archived: false,
    version: 1,
  };
};

const a = loc('Building A', null);
const l2 = loc('Level 2', a.id, 20);
const l1 = loc('Level 1', a.id, 10);
const u = loc('Unit 201', l2.id);
const b = loc('Building B', null, 5);

describe('location tree', () => {
  it('orders siblings by sort then name and nests children', () => {
    const tree = buildTree([u, l2, b, a, l1]);
    expect(tree.map((t) => t.location.name)).toEqual(['Building A', 'Building B']);
    expect(tree[0]!.children.map((c) => c.location.name)).toEqual(['Level 1', 'Level 2']);
  });

  it('flattens depth-first with depth for indenting', () => {
    expect(flatten([u, l2, b, a, l1]).map((r) => [r.location.name, r.depth])).toEqual([
      ['Building A', 0],
      ['Level 1', 1],
      ['Level 2', 1],
      ['Unit 201', 2],
      ['Building B', 0],
    ]);
  });

  it('never offers a place or anything inside it as its own parent', () => {
    expect([...descendantIds([a, l1, l2, u, b], l2.id)].sort()).toEqual([l2.id, u.id].sort());
  });
});
