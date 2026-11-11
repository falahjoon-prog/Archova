// Task rules: the ad-hoc task states, how due dates fall into the "my tasks" buckets, and the plain-language
// "my day" digest. Pure, no IO. Dates are local dates (`@archova/time`), never instants.
import { addDays, compareLocalDates, type LocalDate } from '@archova/time';

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Where a "my tasks" row comes from. Only `task` rows are edited in place; the rest open in their own module. */
export const TASK_SOURCES = ['task', 'meeting_action', 'incident_action'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 5000;

/** Trims and collapses a title; null when it is empty or too long. */
export function cleanTaskTitle(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= TASK_TITLE_MAX ? s : null;
}

/** First line of a free-text body as a title ("Meeting action" rows have no separate title). */
export function titleFromBody(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

/** Overdue is strictly before today; "week" is tomorrow through the next 7 days. */
export function dueBucket(dueDate: LocalDate | null, today: LocalDate): DueBucket {
  if (!dueDate) return 'none';
  const c = compareLocalDates(dueDate, today);
  if (c < 0) return 'overdue';
  if (c === 0) return 'today';
  return compareLocalDates(dueDate, addDays(today, 7)) <= 0 ? 'week' : 'later';
}

export interface DigestRow {
  key: string;
  title: string;
  dueDate: LocalDate | null;
  priority: TaskPriority | null;
  bucket: DueBucket;
  projectName: string;
}

export interface DayDigest {
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  /** The few rows to look at first: overdue (oldest first), then high priority due today. */
  focus: DigestRow[];
  /** One plain sentence or short paragraph; built by rule, not by a model. */
  summary: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Rule-based "my day": counts, the rows to do first and a readable summary. */
export function buildDayDigest(rows: readonly DigestRow[], focusLimit = 5): DayDigest {
  const overdue = rows.filter((r) => r.bucket === 'overdue');
  const today = rows.filter((r) => r.bucket === 'today');
  const week = rows.filter((r) => r.bucket === 'week');
  const byDue = (a: DigestRow, b: DigestRow) =>
    compareLocalDates(a.dueDate ?? '9999-12-31', b.dueDate ?? '9999-12-31');
  const focus = [
    ...[...overdue].sort(byDue),
    ...today.filter((r) => r.priority === 'high'),
    ...today.filter((r) => r.priority !== 'high'),
  ].slice(0, focusLimit);
  let summary: string;
  if (overdue.length + today.length + week.length === 0) {
    summary = 'Nothing is overdue or due in the next week. You are clear.';
  } else {
    const parts: string[] = [];
    if (overdue.length) parts.push(`${plural(overdue.length, 'item is', 'items are')} overdue`);
    if (today.length) parts.push(`${plural(today.length, 'item is', 'items are')} due today`);
    if (week.length)
      parts.push(`${plural(week.length, 'item falls', 'items fall')} due in the next 7 days`);
    summary = `${parts.join(', ')}.`;
    const first = focus[0];
    if (first) summary += ` Start with "${first.title}" on ${first.projectName}.`;
  }
  return {
    overdue: overdue.length,
    dueToday: today.length,
    dueThisWeek: week.length,
    focus,
    summary,
  };
}
