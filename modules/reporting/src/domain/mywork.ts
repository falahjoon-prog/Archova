import { addDays, compareLocalDates } from '@archova/time';

// "My Work": what is due across the projects a person can open. Dates are project-local calendar dates.

export const WORK_SOURCES = ['rfis', 'defects', 'submittals'] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];

export const BUCKETS = ['overdue', 'today', 'next7'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Items per source and project read, items returned, and recently raised items returned. */
export const WORK_ROWS_PER_PROJECT = 200;
export const WORK_ITEMS_MAX = 100;
export const RECENT_MAX = 15;
export const RECENT_DAYS = 14;
export const BOOKMARKS_MAX = 50;

/** Overdue (before today), today, or in the 7 days after today; null when there is no due date or it is later. */
export function bucketOf(dueDate: string | null, today: string): Bucket | null {
  if (!dueDate) return null;
  if (compareLocalDates(dueDate, today) < 0) return 'overdue';
  if (dueDate === today) return 'today';
  return compareLocalDates(dueDate, addDays(today, 7)) <= 0 ? 'next7' : null;
}

export interface WorkItem {
  source: WorkSource;
  projectId: string;
  project: string;
  ref: string;
  title: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
  bucket: Bucket | null;
}

/** Most urgent first: overdue, then today, then the week; within a bucket the earliest due date. */
export function orderItems<T extends Pick<WorkItem, 'bucket' | 'dueDate' | 'project' | 'ref'>>(
  items: readonly T[],
): T[] {
  const rank = (b: Bucket | null) => (b ? BUCKETS.indexOf(b) : BUCKETS.length);
  return [...items].sort(
    (a, b) =>
      rank(a.bucket) - rank(b.bucket) ||
      (a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
      a.project.localeCompare(b.project) ||
      a.ref.localeCompare(b.ref),
  );
}

/** Newest first. */
export const orderRecent = <T extends Pick<WorkItem, 'createdAt' | 'ref'>>(
  items: readonly T[],
): T[] =>
  [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.ref.localeCompare(b.ref));

/** A bookmark is an in-app path: it must start with one slash, never `//` (another site) or a scheme. */
export function isAppPath(path: string): boolean {
  return (
    path.length >= 1 &&
    path.length <= 300 &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(path)
  );
}
