import { describe, expect, it } from 'vitest';
import {
  blockingHolds,
  draftPhaseSummary,
  insightsFor,
  isOverdue,
  itemNumber,
  titleMatch,
  type FlatItem,
  type InsightItem,
} from '../../src/domain/plan';
import { STANDARD_PLAN } from '../../src/domain/template';

const flat = (
  id: string,
  phasePosition: number,
  position: number,
  over: Partial<FlatItem> = {},
): FlatItem => ({
  id,
  phaseId: `ph${phasePosition}`,
  phasePosition,
  position,
  status: 'not_started',
  types: ['document'],
  holdCleared: false,
  ...over,
});

describe('hold points', () => {
  const hold = flat('h1', 1, 3, { types: ['document', 'hold_point'] });
  const all = [flat('a', 1, 1), flat('b', 1, 2), hold, flat('c', 2, 1), flat('d', 3, 1)];

  it('blocks every later item, in this phase and after, but not earlier ones', () => {
    expect(blockingHolds(all, all[0]!)).toEqual([]);
    expect(blockingHolds(all, all[1]!)).toEqual([]);
    expect(blockingHolds(all, all[3]!).map((h) => h.id)).toEqual(['h1']);
    expect(blockingHolds(all, all[4]!).map((h) => h.id)).toEqual(['h1']);
  });
  it('does not block itself', () => {
    expect(blockingHolds(all, hold)).toEqual([]);
  });
  it('lets work through once the hold is cleared', () => {
    const cleared = all.map((i) =>
      i.id === 'h1' ? { ...i, holdCleared: true, status: 'complete' as const } : i,
    );
    expect(blockingHolds(cleared, cleared[3]!)).toEqual([]);
  });
  it('a later hold is blocked by an earlier one', () => {
    const later = flat('h2', 2, 2, { types: ['hold_point'] });
    expect(blockingHolds([...all, later], later).map((h) => h.id)).toEqual(['h1']);
  });
});

describe('overdue and insights', () => {
  const item = (id: string, over: Partial<InsightItem>): InsightItem => ({
    ...flat(id, 1, 1),
    number: '1.1',
    title: id,
    dueDate: null,
    phaseTitle: 'Feasibility',
    ...over,
  });
  it('only an incomplete item with a past due date is overdue', () => {
    expect(isOverdue('not_started', '2026-11-06', '2026-11-07')).toBe(true);
    expect(isOverdue('complete', '2026-11-06', '2026-11-07')).toBe(false);
    expect(isOverdue('in_progress', '2026-11-07', '2026-11-07')).toBe(false);
    expect(isOverdue('in_progress', null, '2026-11-07')).toBe(false);
  });
  it('lists overdue worst first, at risk within a week, and holds that hold things up', () => {
    const r = insightsFor(
      [
        item('late', { dueDate: '2026-11-01' }),
        item('later', { dueDate: '2026-10-20', position: 2 }),
        item('soon', { dueDate: '2026-11-10', position: 3 }),
        item('far', { dueDate: '2026-12-25', position: 4 }),
        item('done', { dueDate: '2026-10-01', status: 'complete', position: 5 }),
        item('hold', { types: ['hold_point'], position: 6 }),
        item('after', { phasePosition: 2, phaseId: 'ph2' }),
      ],
      '2026-11-07',
    );
    expect(r.overdue.map((o) => o.itemId)).toEqual(['later', 'late']);
    expect(r.overdue[0]!.daysLate).toBe(18);
    expect(r.atRisk.map((o) => o.itemId)).toEqual(['soon']);
    expect(r.blockedByHold).toEqual([
      { holdItemId: 'hold', number: '1.1', title: 'hold', blockedCount: 1 },
    ]);
  });
});

describe('titleMatch', () => {
  it('matches an item to a record of the same name', () => {
    expect(titleMatch('Phase I ESA', 'Phase I ESA Report Review 1')).toBeGreaterThanOrEqual(0.5);
  });
  it('does not match unrelated names', () => {
    expect(titleMatch('Geotechnical survey', 'Level 3 slab pour')).toBe(0);
    expect(titleMatch('', 'anything')).toBe(0);
  });
});

describe('phase summary', () => {
  it('states progress, overdue items and waiting holds, and nothing else', () => {
    const text = draftPhaseSummary(
      {
        number: 2,
        title: 'Due diligence',
        items: [
          {
            number: '2.1',
            title: 'Site report',
            status: 'complete',
            dueDate: null,
            types: [],
            holdCleared: false,
          },
          {
            number: '2.2',
            title: 'Phase I ESA',
            status: 'in_progress',
            dueDate: '2026-11-01',
            types: [],
            holdCleared: false,
          },
          {
            number: '2.3',
            title: 'Sign-off',
            status: 'not_started',
            dueDate: null,
            types: ['hold_point'],
            holdCleared: false,
          },
        ],
      },
      '2026-11-07',
    );
    expect(text).toBe(
      'Phase 2, Due diligence: 1 of 3 items complete. 1 overdue: 2.2 Phase I ESA. Waiting on hold point clearance: 2.3 Sign-off.',
    );
  });
  it('says so when the phase is done', () => {
    expect(
      draftPhaseSummary(
        {
          number: 1,
          title: 'A',
          items: [
            {
              number: '1.1',
              title: 'x',
              status: 'complete',
              dueDate: null,
              types: [],
              holdCleared: false,
            },
          ],
        },
        '2026-11-07',
      ),
    ).toContain('The phase is complete.');
  });
});

describe('standard plan', () => {
  it('has numbered phases with items and numbers items as phase.position', () => {
    expect(STANDARD_PLAN.length).toBeGreaterThanOrEqual(5);
    expect(itemNumber(2, 3)).toBe('2.3');
    expect(STANDARD_PLAN.every((p) => p.items.length > 0)).toBe(true);
    expect(STANDARD_PLAN.flatMap((p) => p.items).some((i) => i.types.includes('hold_point'))).toBe(
      true,
    );
  });
});
