import { encodeId } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { addDays, localDateOf } from '@archova/time';
import {
  RECENT_DAYS,
  RECENT_MAX,
  WORK_ITEMS_MAX,
  WORK_ROWS_PER_PROJECT,
  WORK_SOURCES,
  bucketOf,
  orderItems,
  orderRecent,
  type Bucket,
  type WorkItem,
} from '../domain/mywork';
import { toolOf, visibleProjects, type ReportingDeps } from './sources';
import type { RiskDeps } from './risk';

/**
 * The My Work page: one person's open items due across the projects they can open, and what was raised lately.
 * Everything is read through the tool modules as the caller, so nothing appears that they could
 * not open on that project.
 */
export function createMyWorkService(deps: ReportingDeps & Pick<RiskDeps, 'platform' | 'now'>) {
  const now = deps.now ?? (() => new Date());
  async function get(scope: TenantScope) {
    const { projects, truncated: moreProjects } = await visibleProjects(deps, scope, {
      includeClosed: false,
    });
    const items: WorkItem[] = [];
    let restrictedProjects = 0;
    let truncated = moreProjects;
    for (const p of projects) {
      const { timezone } = await deps.platform.getProject(scope, p.id);
      const today = localDateOf(now(), timezone);
      let restricted = false;
      for (const source of WORK_SOURCES) {
        const found = await toolOf(deps, source).reportRows(scope, p.id, {
          state: 'open',
          limit: WORK_ROWS_PER_PROJECT,
        });
        if (found.restricted) {
          restricted = true;
          continue;
        }
        if (found.truncated) truncated = true;
        for (const r of found.rows) {
          items.push({
            source,
            projectId: p.id,
            project: p.name,
            ref: r.ref,
            title: r.title,
            status: r.status,
            dueDate: r.dueDate,
            createdAt: r.createdAt,
            bucket: bucketOf(r.dueDate, today),
          });
        }
      }
      if (restricted) restrictedProjects++;
    }

    const counts: Record<Bucket, number> = { overdue: 0, today: 0, next7: 0 };
    for (const i of items) if (i.bucket) counts[i.bucket]++;
    const due = orderItems(items.filter((i) => i.bucket));
    const since = addDays(now().toISOString().slice(0, 10), -RECENT_DAYS);
    const recent = orderRecent(items.filter((i) => i.createdAt.slice(0, 10) >= since)).slice(
      0,
      RECENT_MAX,
    );
    const dto = (i: WorkItem) => ({
      source: i.source,
      projectId: encodeId('project', i.projectId),
      project: i.project,
      ref: i.ref,
      title: i.title,
      status: i.status,
      dueDate: i.dueDate,
      createdAt: i.createdAt,
      bucket: i.bucket,
    });
    return {
      counts,
      items: due.slice(0, WORK_ITEMS_MAX).map(dto),
      recent: recent.map(dto),
      restrictedProjects,
      truncated: truncated || due.length > WORK_ITEMS_MAX,
      generatedAt: now().toISOString(),
    };
  }

  return { get };
}

export type MyWorkService = ReturnType<typeof createMyWorkService>;
