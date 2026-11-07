import { addDays, compareLocalDates } from '@archova/time';
import type { DonutSlice, TonedBar } from '@archova/ui';
import type { CoordinationIssue } from '../data/api';
import { STATUS_LABEL, isActive } from './issues';

const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'] as const;

/** Overview: how many issues are in each status. */
export function statusSlices(issues: readonly CoordinationIssue[]): DonutSlice[] {
  return STATUS_ORDER.map((s) => ({
    label: STATUS_LABEL[s],
    value: issues.filter((i) => i.status === s).length,
  }));
}

/** Share of issues that are resolved or closed, as a whole percentage (0 when there are none). */
export function percentDone(issues: readonly CoordinationIssue[]): number {
  if (issues.length === 0) return 0;
  const done = issues.filter((i) => !isActive(i.status)).length;
  return Math.round((done / issues.length) * 100);
}

/** Progress: where the issues that still need action stand against their due dates. `today` is the project's local date. */
export function deadlineBars(issues: readonly CoordinationIssue[], today: string): TonedBar[] {
  const active = issues.filter((i) => isActive(i.status));
  const soon = addDays(today, 7);
  const count = (f: (due: string | null) => boolean) => active.filter((i) => f(i.dueDate)).length;
  return [
    {
      label: 'Overdue',
      tone: 'danger',
      value: count((d) => d !== null && compareLocalDates(d, today) < 0),
    },
    {
      label: 'Due in 7 days',
      tone: 'warning',
      value: count(
        (d) => d !== null && compareLocalDates(d, today) >= 0 && compareLocalDates(d, soon) <= 0,
      ),
    },
    {
      label: 'Due later',
      tone: 'info',
      value: count((d) => d !== null && compareLocalDates(d, soon) > 0),
    },
    { label: 'No due date', tone: 'neutral', value: count((d) => d === null) },
  ];
}

/** Ball in court: who the issues that still need action are waiting on, busiest first. */
export function ballInCourt(
  issues: readonly CoordinationIssue[],
  nameOf: (assigneeId: string) => string,
  limit = 6,
): TonedBar[] {
  const counts = new Map<string | null, number>();
  for (const i of issues) {
    if (!isActive(i.status)) continue;
    counts.set(i.assigneeId, (counts.get(i.assigneeId) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([id, value]) => ({ id, value, label: id ? nameOf(id) : 'Unassigned' }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'en-AU'));
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((n, r) => n + r.value, 0);
  return [
    ...shown.map((r): TonedBar => ({
      label: r.label,
      value: r.value,
      tone: r.id ? 'info' : 'warning',
    })),
    ...(rest > 0 ? [{ label: 'Everyone else', value: rest, tone: 'neutral' as const }] : []),
  ];
}
