import { webRoutes } from '@archova/routes';
import type { MyTask } from '../data/api';

export const SOURCE_LABEL: Record<MyTask['source'], string> = {
  task: 'Task',
  meeting_action: 'Meeting action',
  incident_action: 'Incident action',
};

export const BUCKET_LABEL: Record<MyTask['bucket'], string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Next 7 days',
  later: 'Later',
  none: 'No due date',
};

export const BUCKET_ORDER: readonly MyTask['bucket'][] = [
  'overdue',
  'today',
  'week',
  'later',
  'none',
];

/** Where the item lives. Ad-hoc tasks have no page of their own yet, so they have no link. */
export function sourceHref(orgSlug: string, t: MyTask): string | null {
  if (t.source === 'meeting_action' && t.parentId)
    return webRoutes.meeting(orgSlug, t.projectId, t.parentId);
  if (t.source === 'incident_action' && t.parentId)
    return webRoutes.incidents(orgSlug, t.projectId, t.parentId);
  return null;
}

/** Groups rows into the due buckets in display order, dropping empty ones. */
export function groupByBucket(rows: readonly MyTask[]) {
  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: rows.filter((r) => r.bucket === bucket),
  })).filter((g) => g.rows.length > 0);
}
