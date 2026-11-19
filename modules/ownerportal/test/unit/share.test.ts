import { describe, expect, it } from 'vitest';
import { upcomingMilestones } from '../../src/domain/share';

describe('upcomingMilestones', () => {
  it('drops finished milestones and puts dated ones first, soonest first', () => {
    const r = upcomingMilestones([
      { name: 'Done', date: '2026-01-01', status: 'done' },
      { name: 'Undated', date: null, status: 'on_track' },
      { name: 'Later', date: '2026-12-01', status: 'on_track' },
      { name: 'Sooner', date: '2026-11-01', status: 'late' },
    ]);
    expect(r.map((m) => m.name)).toEqual(['Sooner', 'Later', 'Undated']);
  });

  it('keeps entry order for ties and returns nothing when everything is done', () => {
    expect(
      upcomingMilestones([
        { name: 'A', date: '2026-11-01', status: 'on_track' },
        { name: 'B', date: '2026-11-01', status: 'on_track' },
      ]).map((m) => m.name),
    ).toEqual(['A', 'B']);
    expect(upcomingMilestones([{ name: 'X', date: null, status: 'done' }])).toEqual([]);
  });
});
