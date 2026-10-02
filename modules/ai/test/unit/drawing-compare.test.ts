import { describe, expect, it } from 'vitest';
import {
  diffSheets,
  isNearChange,
  reviewCompare,
  sheetLines,
  type SheetLine,
} from '../../src/domain/drawing-compare';

const line = (text: string, x: number, y: number): SheetLine => ({ text, x, y });

describe('sheet text diff (F21)', () => {
  it('groups PDF items into lines in top-left coordinates', () => {
    const lines = sheetLines(
      [
        { str: 'NOTE 1', x: 100, y: 700, height: 10 },
        { str: 'CEILING 2400', x: 200, y: 701, height: 10 },
        { str: 'REV C', x: 500, y: 50, height: 10 },
      ],
      { width: 600, height: 800 },
    );
    expect(lines.map((l) => l.text)).toEqual(['NOTE 1  CEILING 2400', 'REV C']);
    expect(lines[0]!.x).toBeCloseTo(1 / 6);
    expect(lines[0]!.y).toBeCloseTo(0.125, 2);
    expect(lines[1]!.y).toBeCloseTo(0.9375);
  });

  it('finds changed, added and removed lines; moved lines are not changes', () => {
    const before = [
      line('CEILING HEIGHT 2400 AFFL', 0.2, 0.3),
      line('GRID A', 0.1, 0.1),
      line('BALUSTRADE TBC', 0.5, 0.5),
      line('REV C', 0.9, 0.95),
    ];
    const after = [
      line('GRID A', 0.4, 0.1),
      line('CEILING HEIGHT 2700 AFFL', 0.21, 0.3),
      line('PENETRATION P4 300 DIA', 0.3, 0.6),
      line('REV D', 0.9, 0.95),
    ];
    const { changes, truncated } = diffSheets(before, after);
    expect(truncated).toBe(false);
    expect(
      changes.map(({ id, kind, before: b, after: a, titleBlock }) => ({
        id,
        kind,
        b,
        a,
        titleBlock,
      })),
    ).toEqual([
      {
        id: 'c1',
        kind: 'changed',
        b: 'CEILING HEIGHT 2400 AFFL',
        a: 'CEILING HEIGHT 2700 AFFL',
        titleBlock: false,
      },
      { id: 'c2', kind: 'removed', b: 'BALUSTRADE TBC', a: null, titleBlock: false },
      { id: 'c3', kind: 'added', b: null, a: 'PENETRATION P4 300 DIA', titleBlock: false },
      { id: 'c4', kind: 'changed', b: 'REV C', a: 'REV D', titleBlock: true },
    ]);
  });

  it('finds nothing when only positions differ', () => {
    expect(diffSheets([line('A', 0.1, 0.1)], [line('A', 0.5, 0.5)]).changes).toEqual([]);
  });
});

describe('compare review', () => {
  const { changes } = diffSheets(
    [line('CEILING HEIGHT 2400 AFFL', 0.2, 0.3), line('SLAB 200 THK', 0.5, 0.5)],
    [line('CEILING HEIGHT 2700 AFFL', 0.2, 0.3), line('SLAB 250 THK', 0.5, 0.5)],
  );

  it('keeps items backed by real changes and lists what they skipped', () => {
    const r = reviewCompare(
      {
        headline: 'Ceiling raised to 2700.',
        items: [
          { text: 'Ceiling height changed from 2400 to 2700 AFFL.', changeIds: ['c1', 'c99'] },
          { text: 'Slab now 300 thick.', changeIds: ['c2'] },
          { text: 'Something vague.', changeIds: ['c42'] },
        ],
      },
      changes,
      { fromRev: 'C', toRev: 'D' },
    );
    expect(r.items).toEqual([
      { text: 'Ceiling height changed from 2400 to 2700 AFFL.', changeIds: ['c1'] },
    ]);
    expect(r.dropped).toBe(2);
    expect(r.unexplained).toEqual(['c2']);
    expect(r.headline).toBe('Ceiling raised to 2700.');
  });

  it('replaces a headline with an untraceable number', () => {
    const r = reviewCompare({ headline: '3 walls moved.', items: [] }, changes, {
      fromRev: 'C',
      toRev: 'D',
    });
    expect(r.headline).toBe('2 text changes from revision C to D.');
  });

  it('marks pins near a drawing change, not near the title block', () => {
    expect(isNearChange({ x: 0.25, y: 0.32 }, changes)).toBe(true);
    expect(isNearChange({ x: 0.9, y: 0.9 }, changes)).toBe(false);
  });
});
