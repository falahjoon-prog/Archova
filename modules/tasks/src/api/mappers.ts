import { encodeId, type IdKind } from '@archova/domain';
import type { MyTask, MyTasks, Task } from '@archova/contracts';
import type { DayDigest } from '@archova/domain';
import type { MyTaskRow, TaskRow } from '../application/tasks';

export const toTask = (r: TaskRow, names: Map<string, string>): Task => ({
  id: encodeId('task', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  title: r.title,
  description: r.description,
  assigneeId: r.assigneeUserId ? encodeId('user', r.assigneeUserId) : null,
  assigneeName: r.assigneeUserId ? (names.get(r.assigneeUserId) ?? 'Former team member') : null,
  dueDate: r.dueDate,
  priority: r.priority,
  status: r.status,
  completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  createdById: encodeId('user', r.createdBy),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

const ID_KIND: Record<MyTaskRow['source'], { id: IdKind; parent: IdKind | null }> = {
  task: { id: 'task', parent: null },
  meeting_action: { id: 'meetingItem', parent: 'meeting' },
  incident_action: { id: 'incidentAction', parent: 'incident' },
};

export function toMyTask(r: MyTaskRow): MyTask {
  const k = ID_KIND[r.source];
  const id = encodeId(k.id, r.id);
  return {
    key: `${r.source}:${id}`,
    source: r.source,
    id,
    parentId: r.parentId && k.parent ? encodeId(k.parent, r.parentId) : null,
    projectId: encodeId('project', r.projectId),
    projectName: r.projectName,
    title: r.title,
    ref: r.ref,
    dueDate: r.dueDate,
    bucket: r.bucket,
    priority: r.priority,
    status: r.status,
  };
}

export function toMyTasks(rows: MyTaskRow[], digest: DayDigest): MyTasks {
  return {
    data: rows.map(toMyTask),
    digest: {
      overdue: digest.overdue,
      dueToday: digest.dueToday,
      dueThisWeek: digest.dueThisWeek,
      summary: digest.summary,
      focus: digest.focus.map((f) => ({
        key: f.key,
        title: f.title,
        projectName: f.projectName,
        dueDate: f.dueDate,
        bucket: f.bucket,
      })),
    },
  };
}
