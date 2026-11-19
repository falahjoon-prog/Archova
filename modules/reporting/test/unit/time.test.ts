import { describe, expect, it } from 'vitest';
import {
  classOf,
  summariseTime,
  weekEndOf,
  weekStartOf,
  type CostCodeRef,
  type ProjectTime,
} from '../../src/domain/time';

const codes: CostCodeRef[] = [
  { id: 'c03', code: '03', description: 'Concrete', parentId: null },
  { id: 'c03-020', code: '03-020', description: 'Column formwork', parentId: 'c03' },
  { id: 'c5003', code: '5003', description: 'Sheet metal', parentId: null },
];
const line = (
  workerId: string,
  minutes: number,
  costCodeId: string | null,
  status = 'approved',
) => ({
  workerId,
  workerName: workerId.toUpperCase(),
  localDate: '2026-11-03',
  status,
  minutes,
  costCodeId,
});
const project = (over: Partial<ProjectTime> & { id: string }): ProjectTime => ({
  name: over.id,
  restricted: false,
  lines: [],
  codes,
  ...over,
});

describe('week', () => {
  it('runs Monday to Sunday', () => {
    expect(weekStartOf('2026-11-07')).toBe('2026-11-02'); // Saturday
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02'); // Monday
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02'); // Sunday
    expect(weekEndOf('2026-11-02')).toBe('2026-11-08');
  });
});

describe('class of a cost code', () => {
  const byId = new Map(codes.map((c) => [c.id, c]));
  it('is the top-level code above it', () => {
    expect(classOf('c03-020', byId)?.code).toBe('03');
    expect(classOf('c03', byId)?.code).toBe('03');
    expect(classOf('missing', byId)).toBeNull();
  });
  it('survives a parent cycle', () => {
    const loop = new Map<string, CostCodeRef>([
      ['a', { id: 'a', code: 'A', description: '', parentId: 'b' }],
      ['b', { id: 'b', code: 'B', description: '', parentId: 'a' }],
    ]);
    expect(classOf('a', loop)).not.toBeNull();
  });
});

describe('time summary', () => {
  const alpha = project({
    id: 'alpha',
    name: 'Alpha Tower',
    lines: [
      line('w1', 480, 'c03-020'),
      line('w1', 120, 'c03'),
      line('w2', 300, 'c5003', 'submitted'),
      line('w2', 60, null, 'draft'),
    ],
  });
  const bravo = project({ id: 'bravo', name: 'Bravo Lofts', lines: [line('w1', 240, 'c5003')] });

  it('adds hours per employee across projects, biggest first', () => {
    const s = summariseTime('2026-11-02', [alpha, bravo]);
    expect(s.totalHours).toBe(20);
    expect(s.byEmployee.map((e) => [e.name, e.hours])).toEqual([
      ['W1', 14],
      ['W2', 6],
    ]);
    expect(s.byEmployee[0]!.projects).toEqual([
      { projectId: 'alpha', name: 'Alpha Tower', hours: 10 },
      { projectId: 'bravo', name: 'Bravo Lofts', hours: 4 },
    ]);
  });

  it('groups hours into classes with percentages that cover the week', () => {
    const s = summariseTime('2026-11-02', [alpha, bravo]);
    expect(s.byClass.map((c) => [c.label, c.hours, c.percent])).toEqual([
      ['03 Concrete', 10, 50],
      ['5003 Sheet metal', 9, 45],
      ['No cost code', 1, 5],
    ]);
  });

  it('splits each project by timesheet state', () => {
    const s = summariseTime('2026-11-02', [alpha]);
    expect(s.byProject[0]).toMatchObject({ hours: 16, approved: 10, submitted: 5, draft: 1 });
  });

  it('lists hours per cost code with the project, busiest first', () => {
    const s = summariseTime('2026-11-02', [alpha, bravo]);
    expect(s.byCostCode[0]).toMatchObject({ code: '03-020', hours: 8, projectName: 'Alpha Tower' });
    expect(
      s.byCostCode.some((r) => r.costCodeId === null && r.description === 'No cost code'),
    ).toBe(true);
  });

  it('leaves out a project the caller cannot read and says so', () => {
    const s = summariseTime('2026-11-02', [
      alpha,
      project({ id: 'secret', restricted: true, lines: [line('w9', 6000, null)] }),
    ]);
    expect(s.restrictedProjects).toBe(1);
    expect(s.totalHours).toBe(16);
    expect(s.byEmployee.some((e) => e.name === 'W9')).toBe(false);
  });

  it('does not group when cost codes are not readable', () => {
    const s = summariseTime('2026-11-02', [
      project({ id: 'p', codes: null, lines: [line('w1', 60, 'c03')] }),
    ]);
    expect(s.byClass).toEqual([
      { key: 'hidden', label: 'Cost codes not visible', hours: 1, percent: 100 },
    ]);
  });

  it('is empty, not broken, for a quiet week', () => {
    const s = summariseTime('2026-11-02', [project({ id: 'p' })]);
    expect(s).toMatchObject({ totalHours: 0, byEmployee: [], byClass: [], byCostCode: [] });
  });
});
