import { and, asc, desc, eq, gte, isNull, sql, type SQL } from 'drizzle-orm';
import {
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  buildDayDigest,
  cleanTaskTitle,
  dueBucket,
  titleFromBody,
  uuidv7,
  type DayDigest,
  type DueBucket,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
} from '@archova/domain';
import { AppError, nextNumber, type TenantScope } from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf, type LocalDate } from '@archova/time';
import { tasks } from '../infra/tables';

export type TaskRow = typeof tasks.$inferSelect;

/** An open item another module hands to the rollup. Raw uuids; the route layer encodes them. */
export interface RollupSourceRow {
  source: Exclude<TaskSource, 'task'>;
  id: string;
  parentId: string;
  projectId: string;
  title: string;
  ref: string;
  dueDate: LocalDate | null;
}

/** Reads a person's open items from one module. Called inside the caller's tenant transaction. */
export type RollupSource = (scope: TenantScope, userId: string) => Promise<RollupSourceRow[]>;

export interface TasksDeps {
  platform: Pick<PlatformApi, 'getProject' | 'getProjectMembership'>;
  identity: Pick<IdentityApi, 'getUsers'>;
  /** Modules whose action items appear in "my tasks". Adding a source is one entry here (compose). */
  sources: readonly RollupSource[];
  now?: () => Date;
}

export interface MyTaskRow {
  source: TaskSource;
  id: string;
  parentId: string | null;
  projectId: string;
  projectName: string;
  title: string;
  ref: string | null;
  dueDate: LocalDate | null;
  bucket: DueBucket;
  priority: TaskPriority | null;
  status: TaskStatus;
}

const DONE_WINDOW_DAYS = 30;
const LIST_LIMIT = 500;

export function createTasksService(deps: TasksDeps) {
  const now = deps.now ?? (() => new Date());

  function requireTeam(scope: TenantScope) {
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', 'Tasks are for the project team.');
  }

  function bad(path: string, message: string): never {
    throw new AppError('validation_failed', message, [{ path, message }]);
  }

  async function names(ids: readonly (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => x !== null))];
    const users = wanted.length ? await deps.identity.getUsers(wanted) : new Map();
    return new Map<string, string>(
      [...users].map(([id, u]: [string, { name: string; email: string }]) => [
        id,
        u.name || u.email,
      ]),
    );
  }

  /** The assignee must be an active, non-external member of the project. */
  async function checkAssignee(scope: TenantScope, projectId: string, userId: string) {
    const m = await deps.platform.getProjectMembership(scope, projectId, userId);
    if (!m || m.isExternal)
      throw new AppError(
        'task.assignee_not_on_project',
        'Tasks can only be assigned to people on the project team.',
      );
  }

  async function getRow(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('task.not_found');
    return row;
  }

  async function withNames(scope: TenantScope, rows: TaskRow[]) {
    const n = await names(rows.map((r) => r.assigneeUserId));
    void scope;
    return { rows, names: n };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status: TaskStatus | 'all'; assigneeId?: string },
  ) {
    requireTeam(scope);
    await deps.platform.getProject(scope, projectId);
    const where: SQL[] = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
    if (opts.status !== 'all') where.push(eq(tasks.status, opts.status));
    if (opts.assigneeId) where.push(eq(tasks.assigneeUserId, opts.assigneeId));
    const rows = await scope.tx
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.number))
      .limit(LIST_LIMIT);
    return withNames(scope, rows);
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      title: string;
      description?: string | undefined;
      assigneeId?: string | undefined;
      dueDate?: LocalDate | undefined;
      priority?: TaskPriority | undefined;
    },
  ) {
    requireTeam(scope);
    await deps.platform.getProject(scope, projectId);
    const title =
      cleanTaskTitle(input.title) ??
      bad('title', `Enter between 1 and ${TASK_TITLE_MAX} characters`);
    const description = input.description?.trim() || null;
    if (description && description.length > TASK_DESCRIPTION_MAX)
      bad('description', `Enter at most ${TASK_DESCRIPTION_MAX} characters`);
    if (input.assigneeId) await checkAssignee(scope, projectId, input.assigneeId);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'task');
    const [row] = await scope.tx
      .insert(tasks)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        title,
        description,
        assigneeUserId: input.assigneeId ?? null,
        dueDate: input.dueDate ?? null,
        priority: input.priority ?? 'medium',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'tasks.task.created.v1',
      projectId,
      entityType: 'task',
      entityId: id,
      entityVersion: 1,
      data: { taskId: id },
    });
    return withNames(scope, [row!]);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    patch: {
      title?: string | undefined;
      description?: string | null | undefined;
      assigneeId?: string | null | undefined;
      dueDate?: LocalDate | null | undefined;
      priority?: TaskPriority | undefined;
      status?: TaskStatus | undefined;
    },
  ) {
    requireTeam(scope);
    const cur = await getRow(scope, projectId, id);
    if (cur.createdBy !== scope.ctx.userId && cur.assigneeUserId !== scope.ctx.userId)
      throw new AppError(
        'task.not_yours',
        'Only the person who created the task or the person it is assigned to can change it.',
      );
    const set: Partial<typeof tasks.$inferInsert> = {
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
      version: cur.version + 1,
    };
    if (patch.title !== undefined)
      set.title =
        cleanTaskTitle(patch.title) ??
        bad('title', `Enter between 1 and ${TASK_TITLE_MAX} characters`);
    if (patch.description !== undefined) {
      const d = patch.description?.trim() || null;
      if (d && d.length > TASK_DESCRIPTION_MAX)
        bad('description', `Enter at most ${TASK_DESCRIPTION_MAX} characters`);
      set.description = d;
    }
    if (patch.assigneeId !== undefined) {
      if (patch.assigneeId && patch.assigneeId !== cur.assigneeUserId)
        await checkAssignee(scope, projectId, patch.assigneeId);
      set.assigneeUserId = patch.assigneeId;
    }
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.status !== undefined && patch.status !== cur.status) {
      set.status = patch.status;
      const closing = patch.status !== 'open';
      set.completedAt = closing ? now() : null;
      set.completedBy = closing ? scope.ctx.userId : null;
    }
    const [row] = await scope.tx.update(tasks).set(set).where(eq(tasks.id, id)).returning();
    scope.events.add({
      type: 'tasks.task.updated.v1',
      projectId,
      entityType: 'task',
      entityId: id,
      entityVersion: cur.version + 1,
      data: { taskId: id, status: row!.status },
    });
    return withNames(scope, [row!]);
  }

  /**
   * Everything assigned to the caller: ad-hoc tasks plus each source module's open items. A row is dropped when the
   * caller is no longer an active member of its project, so a removed person never keeps seeing project detail.
   */
  async function mine(scope: TenantScope, status: 'open' | 'done') {
    requireTeam(scope);
    const userId = scope.ctx.userId;
    const own = await scope.tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeUserId, userId),
          isNull(tasks.deletedAt),
          status === 'open'
            ? eq(tasks.status, 'open')
            : and(
                eq(tasks.status, 'done'),
                gte(tasks.completedAt, new Date(now().getTime() - DONE_WINDOW_DAYS * 86_400_000)),
              ),
        ),
      )
      .orderBy(status === 'open' ? sql`${tasks.dueDate} asc nulls last` : desc(tasks.completedAt))
      .limit(LIST_LIMIT);
    const external =
      status === 'open'
        ? (await Promise.all(deps.sources.map((s) => s(scope, userId)))).flat()
        : [];

    const projectIds = [
      ...new Set([...own.map((t) => t.projectId), ...external.map((e) => e.projectId)]),
    ];
    const projects = new Map<string, { name: string; timezone: string }>();
    for (const pid of projectIds) {
      const member = await deps.platform.getProjectMembership(scope, pid, userId);
      if (!member || member.isExternal) continue;
      const p = await deps.platform.getProject(scope, pid);
      projects.set(pid, { name: p.name, timezone: p.timezone });
    }
    const today = (pid: string) => localDateOf(now(), projects.get(pid)!.timezone);

    const rows: MyTaskRow[] = [];
    for (const t of own) {
      if (!projects.has(t.projectId)) continue;
      rows.push({
        source: 'task',
        id: t.id,
        parentId: null,
        projectId: t.projectId,
        projectName: projects.get(t.projectId)!.name,
        title: t.title,
        ref: `T-${t.number}`,
        dueDate: t.dueDate,
        bucket: status === 'open' ? dueBucket(t.dueDate, today(t.projectId)) : 'none',
        priority: t.priority,
        status: t.status,
      });
    }
    for (const e of external) {
      if (!projects.has(e.projectId)) continue;
      rows.push({
        source: e.source,
        id: e.id,
        parentId: e.parentId,
        projectId: e.projectId,
        projectName: projects.get(e.projectId)!.name,
        title: e.title,
        ref: e.ref,
        dueDate: e.dueDate,
        bucket: dueBucket(e.dueDate, today(e.projectId)),
        priority: null,
        status: 'open',
      });
    }
    // Overdue first, then by due date; undated last. Ties keep the source order.
    const order: Record<DueBucket, number> = { overdue: 0, today: 1, week: 2, later: 3, none: 4 };
    if (status === 'open')
      rows.sort(
        (a, b) =>
          order[a.bucket] - order[b.bucket] ||
          (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'),
      );
    const digest: DayDigest = buildDayDigest(
      status === 'open'
        ? rows.map((r) => ({
            key: `${r.source}:${r.id}`,
            title: titleFromBody(r.title),
            dueDate: r.dueDate,
            priority: r.priority,
            bucket: r.bucket,
            projectName: r.projectName,
          }))
        : [],
    );
    return { rows, digest };
  }

  return { list, create, update, mine };
}

export type TasksService = ReturnType<typeof createTasksService>;
