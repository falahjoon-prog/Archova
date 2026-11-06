import { and, asc, eq } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import { addDays, localDateOf } from '@archova/time';
import {
  BOOKMARKS_MAX,
  RECENT_DAYS,
  RECENT_MAX,
  WORK_ITEMS_MAX,
  WORK_ROWS_PER_PROJECT,
  WORK_SOURCES,
  bucketOf,
  isAppPath,
  orderItems,
  orderRecent,
  type Bucket,
  type WorkItem,
} from '../domain/mywork';
import { bookmarks } from '../infra/tables';
import { toolOf, visibleProjects, type ReportingDeps } from './sources';
import type { RiskDeps } from './risk';

export interface BookmarkInput {
  label: string;
  path: string;
  projectId?: string | undefined;
}

/**
 * The My Work page: one person's open items due across the projects they can open, what was raised lately, and
 * their bookmarks. Everything is read through the tool modules as the caller, so nothing appears that they could
 * not open on that project. Bookmarks belong to the person who saved them and are never visible to anyone else.
 */
export function createMyWorkService(deps: ReportingDeps & Pick<RiskDeps, 'platform' | 'now'>) {
  const now = deps.now ?? (() => new Date());
  type Row = typeof bookmarks.$inferSelect;
  const bookmarkDto = (r: Row) => ({
    id: encodeId('bookmark', r.id),
    label: r.label,
    path: r.path,
    projectId: r.projectId ? encodeId('project', r.projectId) : null,
    createdAt: r.createdAt.toISOString(),
  });

  async function listBookmarks(scope: TenantScope) {
    const rows = await scope.tx
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.userId, scope.ctx.userId))
      .orderBy(asc(bookmarks.label), asc(bookmarks.id))
      .limit(BOOKMARKS_MAX);
    return rows.map(bookmarkDto);
  }

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
      bookmarks: await listBookmarks(scope),
      restrictedProjects,
      truncated: truncated || due.length > WORK_ITEMS_MAX,
      generatedAt: now().toISOString(),
    };
  }

  async function addBookmark(scope: TenantScope, input: BookmarkInput) {
    const label = input.label.trim();
    if (!label)
      throw new AppError('validation_failed', 'Label is required', [
        { path: 'label', message: 'Required' },
      ]);
    if (!isAppPath(input.path))
      throw new AppError('validation_failed', 'Path must be a page in the app', [
        { path: 'path', message: 'Must start with a single "/"' },
      ]);
    let projectId: string | null = null;
    if (input.projectId) {
      projectId = decodeId('project', input.projectId);
      if (!projectId)
        throw new AppError('validation_failed', 'Invalid id', [
          { path: 'projectId', message: 'Invalid id' },
        ]);
      // Only a project the caller can open (listProjects is already narrowed to their access).
      await deps.platform.getProject(scope, projectId);
    }
    const mine = eq(bookmarks.userId, scope.ctx.userId);
    const [existing] = await scope.tx
      .select()
      .from(bookmarks)
      .where(and(mine, eq(bookmarks.path, input.path)))
      .limit(1);
    if (existing) return bookmarkDto(existing);
    const count = (await scope.tx.select({ id: bookmarks.id }).from(bookmarks).where(mine)).length;
    if (count >= BOOKMARKS_MAX) throw new AppError('bookmark.limit_reached');
    const row: Row = {
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      userId: scope.ctx.userId,
      projectId,
      label,
      path: input.path,
      createdAt: new Date(),
    };
    await scope.tx.insert(bookmarks).values(row);
    return bookmarkDto(row);
  }

  async function removeBookmark(scope: TenantScope, id: string) {
    const removed = await scope.tx
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, scope.ctx.userId)))
      .returning({ id: bookmarks.id });
    if (!removed.length) throw new AppError('bookmark.not_found');
  }

  return { get, addBookmark, removeBookmark };
}

export type MyWorkService = ReturnType<typeof createMyWorkService>;
