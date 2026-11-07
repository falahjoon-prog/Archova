import { describe, expect, it } from 'vitest';
import { suggestLocations, withPaths, type LocationRow } from '../../src/application/locations';

let n = 0;
const row = (
  name: string,
  parentId: string | null,
  extra: Partial<LocationRow> = {},
): LocationRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  orgId: 'o',
  projectId: 'p',
  parentId,
  kind: 'area',
  name,
  code: null,
  sort: 0,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  createdBy: null,
  updatedBy: null,
  version: 1,
  ...extra,
});

const a = row('Building A', null, { kind: 'building', code: 'BA' });
const l2 = row('Level 2', a.id, { kind: 'level' });
const u201 = row('Unit 201', l2.id, { kind: 'room' });
const bath = row('Bathroom', u201.id);
const l1 = row('Level 1', a.id, { kind: 'level' });
const u101 = row('Unit 101', l1.id, { kind: 'room' });
const old = row('Old plant room', a.id, { archivedAt: new Date() });
const rows = [a, l2, u201, bath, l1, u101, old];

describe('location paths', () => {
  it('joins names from the top and counts depth', () => {
    const v = withPaths(rows);
    const b = v.find((x) => x.id === bath.id)!;
    expect(b.path).toBe('Building A › Level 2 › Unit 201 › Bathroom');
    expect(b.depth).toBe(4);
    expect(v.find((x) => x.id === a.id)).toMatchObject({ path: 'Building A', depth: 1 });
  });

  it('survives a cycle instead of looping', () => {
    const x = row('X', null);
    const y = row('Y', x.id);
    x.parentId = y.id;
    expect(() => withPaths([x, y])).not.toThrow();
  });
});

describe('Nova location suggestion (rule-based)', () => {
  const views = withPaths(rows);

  it('puts the most specific place the text names first', () => {
    const s = suggestLocations(views, 'Cracked tile in Unit 201 bathroom, level 2');
    expect(s[0]!.path).toBe('Building A › Level 2 › Unit 201 › Bathroom');
    expect(s[0]!.reason).toContain('Unit 201');
  });

  it('does not offer a sibling the text does not mention', () => {
    const s = suggestLocations(views, 'Unit 201 door');
    expect(s.map((x) => x.path)).not.toContain('Building A › Level 1 › Unit 101');
  });

  it('matches a code and never offers an archived place', () => {
    const s = suggestLocations(views, 'BA plant room leak');
    expect(s.some((x) => x.path.includes('Old plant room'))).toBe(false);
    expect(s[0]!.path).toContain('Building A');
  });

  it('returns nothing for text with no place in it', () => {
    expect(suggestLocations(views, 'please review the drawings')).toEqual([]);
    expect(suggestLocations(views, '   ')).toEqual([]);
  });
});
