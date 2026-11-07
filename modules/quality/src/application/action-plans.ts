import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import {
  addDays,
  derivePlanStatus,
  type ActionItemStatus,
  type ActionPlanSourceType,
  type ActionPlanStatus,
  type TemplateItem,
} from '../domain/action-plan';
import {
  actionPlanItems,
  actionPlanTemplates,
  actionPlans,
  inspections,
  observations,
} from '../infra/tables';
import { viewerOf, type QualityDeps } from './shared';

export type PlanRow = typeof actionPlans.$inferSelect;
export type ItemRow = typeof actionPlanItems.$inferSelect;
export type TemplateRow = typeof actionPlanTemplates.$inferSelect;
export interface PlanView extends PlanRow {
  isOverdue: boolean;
  itemCount: number;
  doneCount: number;
}
export interface ItemView extends ItemRow {
  isOverdue: boolean;
  canUpdate: boolean;
}
export interface PlanDetail {
  plan: PlanView;
  items: ItemView[];
  canManage: boolean;
}

export interface NewItem {
  title: string;
  description?: string;
  assigneeCompanyId?: string;
  dueDate?: string;
}
export interface PlanFields {
  title?: string;
  description?: string;
  dueDate?: string | null;
  status?: Extract<ActionPlanStatus, 'active' | 'cancelled'>;
}
export interface ItemFields {
  title?: string;
  description?: string;
  assigneeCompanyId?: string | null;
  dueDate?: string | null;
  status?: ActionItemStatus;
  note?: string | null;
}

const notFound = () => new AppError('action_plan.not_found');

export function createActionPlanService(deps: QualityDeps) {
  const now = deps.now ?? (() => new Date());

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  /** Builder staff with the manage permission may shape plans; everyone else only moves the steps they are given. */
  async function canManage(scope: TenantScope, projectId: string) {
    const v = await viewerOf(deps, scope, projectId);
    return (
      v.isInternal && (await deps.access.can(scope, 'quality.action_plans.manage', { projectId }))
    );
  }
  async function requireManage(scope: TenantScope, projectId: string) {
    if (!(await canManage(scope, projectId)))
      throw new AppError('action_plan.not_allowed', "You can't change action plans.");
  }

  async function checkAssignee(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError(
        'action_plan.assignee_not_on_project',
        'Assign the step to a company on this project.',
        [{ path: 'assigneeCompanyId', message: 'Not a company on the project' }],
      );
  }

  async function checkSource(
    scope: TenantScope,
    projectId: string,
    type: ActionPlanSourceType,
    id: string,
  ) {
    const t = type === 'observation' ? observations : inspections;
    const [row] = await scope.tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.id, id), eq(t.projectId, projectId), isNull(t.deletedAt)))
      .limit(1);
    if (!row)
      throw new AppError('validation_failed', `That ${type} is not on this project.`, [
        { path: 'sourceId', message: `Not an ${type} on the project` },
      ]);
  }

  async function changed(scope: TenantScope, r: PlanRow) {
    await scope.recordChange({
      module: 'quality',
      entityType: 'action_plan',
      entityId: r.id,
      op: 'upsert',
      version: r.version,
      projectId: r.projectId,
      isPrivate: false,
    });
  }

  const itemView = (
    r: ItemRow,
    localToday: string,
    v: { isInternal: boolean; companyId: string | null },
    manage: boolean,
  ): ItemView => ({
    ...r,
    isOverdue: r.status === 'open' && r.dueDate !== null && r.dueDate < localToday,
    canUpdate:
      manage || (!v.isInternal && v.companyId !== null && r.assigneeCompanyId === v.companyId),
  });

  async function loadItems(scope: TenantScope, planId: string) {
    return scope.tx
      .select()
      .from(actionPlanItems)
      .where(eq(actionPlanItems.planId, planId))
      .orderBy(asc(actionPlanItems.sort), asc(actionPlanItems.id));
  }

  async function seeing(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(actionPlans)
      .where(
        and(
          eq(actionPlans.id, id),
          eq(actionPlans.projectId, projectId),
          isNull(actionPlans.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw notFound();
    const v = await viewerOf(deps, scope, projectId);
    const manage = await canManage(scope, projectId);
    const items = await loadItems(scope, id);
    // Someone outside the builder's team sees a plan only when a step is assigned to their company.
    if (!v.isInternal && !items.some((i) => v.companyId && i.assigneeCompanyId === v.companyId))
      throw notFound();
    return { row, items, v, manage };
  }

  async function detail(scope: TenantScope, projectId: string, id: string): Promise<PlanDetail> {
    const { row, items, v, manage } = await seeing(scope, projectId, id);
    const date = await today(scope, projectId);
    return {
      plan: {
        ...row,
        isOverdue: row.status === 'active' && row.dueDate !== null && row.dueDate < date,
        itemCount: items.length,
        doneCount: items.filter((i) => i.status !== 'open').length,
      },
      items: items.map((i) => itemView(i, date, v, manage)),
      canManage: manage,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: ActionPlanStatus; limit: number; cursor?: string },
  ) {
    const date = await today(scope, projectId);
    const v = await viewerOf(deps, scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(actionPlans.projectId, projectId), isNull(actionPlans.deletedAt)];
    if (!v.isInternal) {
      conditions.push(
        v.companyId
          ? sql`exists (select 1 from ${actionPlanItems} i where i.plan_id = ${actionPlans.id}
              and i.assignee_company_id = ${v.companyId})`
          : sql`false`,
      );
    }
    if (opts.status) conditions.push(eq(actionPlans.status, opts.status));
    if (after) conditions.push(lt(actionPlans.id, after.id));
    const rows = await scope.tx
      .select()
      .from(actionPlans)
      .where(and(...conditions))
      .orderBy(desc(actionPlans.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    const counts = new Map<string, { total: number; done: number }>();
    if (page.data.length > 0) {
      const res = await scope.tx
        .select({
          planId: actionPlanItems.planId,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${actionPlanItems.status} <> 'open')::int`,
        })
        .from(actionPlanItems)
        .where(
          inArray(
            actionPlanItems.planId,
            page.data.map((r) => r.id),
          ),
        )
        .groupBy(actionPlanItems.planId);
      for (const c of res) counts.set(c.planId, { total: c.total, done: c.done });
    }
    return {
      data: page.data.map((r): PlanView => ({
        ...r,
        isOverdue: r.status === 'active' && r.dueDate !== null && r.dueDate < date,
        itemCount: counts.get(r.id)?.total ?? 0,
        doneCount: counts.get(r.id)?.done ?? 0,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      title: string;
      description?: string;
      dueDate?: string;
      templateId?: string;
      sourceType?: ActionPlanSourceType;
      sourceId?: string;
      items?: NewItem[];
    },
  ) {
    await requireManage(scope, projectId);
    if ((input.sourceType === undefined) !== (input.sourceId === undefined))
      throw new AppError('validation_failed', 'Give both the source type and its id.', [
        { path: 'sourceId', message: 'Send sourceType and sourceId together' },
      ]);
    if (input.sourceType) await checkSource(scope, projectId, input.sourceType, input.sourceId!);
    const date = await today(scope, projectId);
    let steps: NewItem[] = input.items ?? [];
    let description = input.description;
    if (input.templateId) {
      const [tpl] = await scope.tx
        .select()
        .from(actionPlanTemplates)
        .where(
          and(
            eq(actionPlanTemplates.id, input.templateId),
            eq(actionPlanTemplates.projectId, projectId),
            isNull(actionPlanTemplates.deletedAt),
          ),
        )
        .limit(1);
      if (!tpl) throw new AppError('action_plan_template.not_found');
      steps = tpl.items.map((t) => ({
        title: t.title,
        description: t.description,
        ...(t.dueOffsetDays !== null ? { dueDate: addDays(date, t.dueOffsetDays) } : {}),
      }));
      description ??= tpl.description;
    }
    for (const s of steps)
      if (s.assigneeCompanyId) await checkAssignee(scope, projectId, s.assigneeCompanyId);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'action_plan');
    const [row] = await scope.tx
      .insert(actionPlans)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        title: input.title.trim(),
        description: description?.trim() ?? '',
        dueDate: input.dueDate ?? null,
        templateId: input.templateId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    if (steps.length > 0)
      await scope.tx.insert(actionPlanItems).values(
        steps.map((s, n) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          planId: id,
          sort: n + 1,
          title: s.title.trim(),
          description: s.description?.trim() ?? '',
          assigneeCompanyId: s.assigneeCompanyId ?? null,
          dueDate: s.dueDate ?? null,
          updatedBy: scope.ctx.userId,
        })),
      );
    await changed(scope, row!);
    scope.events.add({
      type: 'quality.action_plan.created.v1',
      projectId,
      entityType: 'action_plan',
      entityId: id,
      entityVersion: 1,
      data: { actionPlanId: id, number, itemCount: steps.length },
    });
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: PlanFields,
  ) {
    await requireManage(scope, projectId);
    const { row, items } = await seeing(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (row.status === 'cancelled' && patch.status === undefined)
      throw new AppError('action_plan.cancelled', 'Reopen the plan before changing it.');
    const status = patch.status === 'cancelled' ? 'cancelled' : derivePlanStatus('active', items);
    const [updated] = await scope.tx
      .update(actionPlans)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.status !== undefined || row.status !== status ? { status } : {}),
        completedAt: status === 'completed' ? (row.completedAt ?? now()) : null,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(actionPlans.id, id), eq(actionPlans.version, expectedVersion)))
      .returning();
    if (!updated) throw versionConflict();
    await changed(scope, updated);
    return detail(scope, projectId, id);
  }

  /** Re-derive the plan's status after its steps changed and bump its version. */
  async function touch(scope: TenantScope, plan: PlanRow) {
    const items = await loadItems(scope, plan.id);
    const status = derivePlanStatus(plan.status, items);
    const [updated] = await scope.tx
      .update(actionPlans)
      .set({
        status,
        completedAt: status === 'completed' ? (plan.completedAt ?? now()) : null,
        version: plan.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(eq(actionPlans.id, plan.id))
      .returning();
    await changed(scope, updated!);
    if (status === 'completed' && plan.status !== 'completed')
      scope.events.add({
        type: 'quality.action_plan.completed.v1',
        projectId: plan.projectId,
        entityType: 'action_plan',
        entityId: plan.id,
        entityVersion: updated!.version,
        data: { actionPlanId: plan.id, number: plan.number },
      });
  }

  async function addItem(scope: TenantScope, projectId: string, planId: string, input: NewItem) {
    await requireManage(scope, projectId);
    const { row, items } = await seeing(scope, projectId, planId);
    if (row.status === 'cancelled')
      throw new AppError('action_plan.cancelled', 'Reopen the plan before adding steps.');
    if (items.length >= 200)
      throw new AppError('validation_failed', 'A plan holds at most 200 steps.');
    if (input.assigneeCompanyId) await checkAssignee(scope, projectId, input.assigneeCompanyId);
    await scope.tx.insert(actionPlanItems).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      planId,
      sort: (items.at(-1)?.sort ?? 0) + 1,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      assigneeCompanyId: input.assigneeCompanyId ?? null,
      dueDate: input.dueDate ?? null,
      updatedBy: scope.ctx.userId,
    });
    await touch(scope, row);
    return detail(scope, projectId, planId);
  }

  /**
   * Builder staff change anything on a step; the company a step is assigned to may only mark it done, skipped
   * or open again and leave a note.
   */
  async function updateItem(
    scope: TenantScope,
    projectId: string,
    planId: string,
    itemId: string,
    patch: ItemFields,
  ) {
    const { row, items, v, manage } = await seeing(scope, projectId, planId);
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new AppError('action_plan.item_not_found');
    const assigned =
      !v.isInternal && v.companyId !== null && item.assigneeCompanyId === v.companyId;
    if (!manage && !assigned)
      throw new AppError('action_plan.not_allowed', "You can't change this step.");
    if (
      !manage &&
      (patch.title !== undefined ||
        patch.description !== undefined ||
        patch.assigneeCompanyId !== undefined ||
        patch.dueDate !== undefined)
    )
      throw new AppError('action_plan.not_allowed', 'You can only mark your steps done.');
    if (row.status === 'cancelled')
      throw new AppError('action_plan.cancelled', 'This plan is cancelled.');
    if (patch.assigneeCompanyId) await checkAssignee(scope, projectId, patch.assigneeCompanyId);
    const at = now();
    await scope.tx
      .update(actionPlanItems)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.assigneeCompanyId !== undefined
          ? { assigneeCompanyId: patch.assigneeCompanyId }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
        ...(patch.status !== undefined
          ? patch.status === 'open'
            ? { status: 'open' as const, completedAt: null, completedBy: null }
            : { status: patch.status, completedAt: at, completedBy: scope.ctx.userId }
          : {}),
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(actionPlanItems.id, itemId), eq(actionPlanItems.planId, planId)));
    await touch(scope, row);
    return detail(scope, projectId, planId);
  }

  async function listTemplates(scope: TenantScope, projectId: string) {
    await requireManage(scope, projectId);
    return scope.tx
      .select()
      .from(actionPlanTemplates)
      .where(
        and(eq(actionPlanTemplates.projectId, projectId), isNull(actionPlanTemplates.deletedAt)),
      )
      .orderBy(asc(actionPlanTemplates.name))
      .limit(200);
  }

  async function createTemplate(
    scope: TenantScope,
    projectId: string,
    input: { name: string; description?: string; items: TemplateItem[] },
  ) {
    await requireManage(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const [row] = await scope.tx
      .insert(actionPlanTemplates)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
        items: input.items.map((i) => ({
          title: i.title.trim(),
          description: i.description.trim(),
          dueOffsetDays: i.dueOffsetDays,
        })),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  /** "Save as template": the plan's steps, minus who and when, become a reusable template. */
  async function saveAsTemplate(
    scope: TenantScope,
    projectId: string,
    planId: string,
    name: string,
  ) {
    await requireManage(scope, projectId);
    const { items } = await seeing(scope, projectId, planId);
    return createTemplate(scope, projectId, {
      name,
      items: items.map((i) => ({
        title: i.title,
        description: i.description,
        dueOffsetDays: null,
      })),
    });
  }

  return {
    list,
    detail,
    create,
    update,
    addItem,
    updateItem,
    listTemplates,
    createTemplate,
    saveAsTemplate,
  };
}

export type ActionPlanService = ReturnType<typeof createActionPlanService>;
