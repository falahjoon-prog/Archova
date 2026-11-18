import { describe, expect, it } from 'vitest';
import type { CoordinationIssue } from '../data/api';
import { ballInCourt, deadlineBars, percentDone, statusSlices } from '../lib/dashboard';

const issue = (over: Partial<CoordinationIssue>): CoordinationIssue => ({
  id: 'cis_1',
  projectId: 'prj_1',
  number: 1,
  title: 'T',
  description: '',
  status: 'open',
  priority: 'medium',
  assigneeId: null,
  dueDate: null,
  modelId: null,
  elementGuids: [],
  location: '',
  rfiId: null,
  pin: null,
  sheetId: null,
  snapshotFileId: null,
  resolvedAt: null,
  commentCount: 0,
  version: 1,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
});

const issues = [
  issue({ id: 'a', status: 'open', assigneeId: 'usr_a', dueDate: '2026-11-01' }),
  issue({ id: 'b', status: 'in_progress', assigneeId: 'usr_a', dueDate: '2026-11-10' }),
  issue({ id: 'c', status: 'open', assigneeId: null, dueDate: '2026-12-25' }),
  issue({ id: 'd', status: 'resolved', assigneeId: 'usr_b', dueDate: '2026-10-01' }),
  issue({ id: 'e', status: 'closed' }),
];

describe('coordination dashboard figures', () => {
  it('counts issues by status', () => {
    expect(statusSlices(issues).map((s) => s.value)).toEqual([2, 1, 1, 1]);
  });

  it('shows the share that is resolved or closed', () => {
    expect(percentDone(issues)).toBe(40);
    expect(percentDone([])).toBe(0);
  });

  it('puts only open work against its due date, relative to the project date', () => {
    const bars = deadlineBars(issues, '2026-11-07');
    expect(Object.fromEntries(bars.map((b) => [b.label, b.value]))).toEqual({
      Overdue: 1,
      'Due in 7 days': 1,
      'Due later': 1,
      'No due date': 0,
    });
    // The 7-day window is inclusive of today and of day seven.
    const edge = deadlineBars(
      [
        issue({ dueDate: '2026-11-07' }),
        issue({ dueDate: '2026-11-14' }),
        issue({ dueDate: '2026-11-15' }),
      ],
      '2026-11-07',
    );
    expect(edge.map((b) => b.value)).toEqual([0, 2, 1, 0]);
  });

  it('lists who open issues are waiting on, busiest first, ignoring finished ones', () => {
    const bars = ballInCourt(issues, (id) => (id === 'usr_a' ? 'Ann' : 'Bob'));
    expect(bars).toEqual([
      { label: 'Ann', value: 2, tone: 'info' },
      { label: 'Unassigned', value: 1, tone: 'warning' },
    ]);
  });

  it('rolls the long tail into one bar', () => {
    const many = Array.from({ length: 8 }, (_, n) =>
      issue({ id: `x${n}`, assigneeId: `usr_${n}` }),
    );
    const bars = ballInCourt(many, (id) => id, 6);
    expect(bars).toHaveLength(7);
    expect(bars.at(-1)).toEqual({ label: 'Everyone else', value: 2, tone: 'neutral' });
  });
});
