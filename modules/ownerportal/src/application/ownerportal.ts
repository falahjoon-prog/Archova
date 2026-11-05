import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import { atLeast } from '@archova/domain/permissions';
import type {
  CreateOwnerApprovalRequest,
  CreateOwnerProgressUpdateRequest,
  DecideOwnerApprovalRequest,
  OwnerApproval,
  OwnerCapitalItem,
  OwnerCapitalItemInput,
  OwnerCapitalPlan,
  OwnerProgressUpdate,
  UpdateOwnerCapitalItemRequest,
  UpdateOwnerProgressUpdateRequest,
} from '@archova/contracts';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { capitalTotals } from '../domain/capital';
import { approvals, capitalItems, progressUpdates } from '../infra/tables';

export interface OwnerPortalDeps {
  access: AccessService;
  platform: PlatformApi;
  now?: () => Date;
}

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

const iso = (d: Date) => d.toISOString();

type UpdateRow = typeof progressUpdates.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type ItemRow = typeof capitalItems.$inferSelect;

export const updateDto = (r: UpdateRow): OwnerProgressUpdate => ({
  id: encodeId('ownerProgressUpdate', r.id),
  projectId: encodeId('project', r.projectId),
  title: r.title,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
  summary: r.summary,
  percentComplete: r.percentComplete,
  milestones: r.milestones,
  status: r.status,
  publishedAt: r.publishedAt ? iso(r.publishedAt) : null,
  version: r.version,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export const approvalDto = (r: ApprovalRow): OwnerApproval => ({
  id: encodeId('ownerApproval', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  title: r.title,
  description: r.description,
  amountCents: r.amountCents,
  dueDate: r.dueDate,
  status: r.status,
  decidedBy: r.decidedBy ? encodeId('user', r.decidedBy) : null,
  decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
  decisionNote: r.decisionNote,
  version: r.version,
  createdAt: iso(r.createdAt),
});

export const itemDto = (r: ItemRow): OwnerCapitalItem => ({
  id: encodeId('ownerCapitalItem', r.id),
  projectId: encodeId('project', r.projectId),
  fiscalYear: r.fiscalYear,
  category: r.category,
  description: r.description,
  budgetCents: r.budgetCents,
  forecastCents: r.forecastCents,
  spentCents: r.spentCents,
  version: r.version,
});

export function createOwnerPortalService(deps: OwnerPortalDeps) {
  const now = deps.now ?? (() => new Date());

  /** The project team (and org owners and admins) see drafts; the client sees only what was published. */
  async function isTeam(scope: TenantScope, projectId: string) {
    const p = await deps.access.effectivePermissions(scope, projectId);
    return (
      p.orgRole === 'owner' ||
      p.orgRole === 'admin' ||
      atLeast(p.toolLevels.owner_portal, 'standard')
    );
  }

  const ref = (kind: IdKind, value: string) => {
    const id = decodeId(kind, value);
    if (!id) throw new AppError('validation_failed', 'Invalid id');
    return id;
  };

  function checkPeriod(start: string, end: string) {
    if (end < start) throw invalid('periodEnd', 'The period ends before it starts');
  }

  // ------------------------------------------------------- progress updates

  async function listUpdates(scope: TenantScope, projectId: string) {
    const team = await isTeam(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(progressUpdates)
      .where(
        and(
          eq(progressUpdates.projectId, projectId),
          team ? undefined : eq(progressUpdates.status, 'published'),
        ),
      )
      .orderBy(desc(progressUpdates.periodEnd), desc(progressUpdates.createdAt));
    return { data: rows.map(updateDto) };
  }

  async function getUpdate(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(progressUpdates)
      .where(and(eq(progressUpdates.id, id), eq(progressUpdates.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('ownerportal.update_not_found');
    return row;
  }

  async function createUpdate(
    scope: TenantScope,
    projectId: string,
    input: CreateOwnerProgressUpdateRequest,
  ) {
    await deps.platform.getProject(scope, projectId);
    checkPeriod(input.periodStart, input.periodEnd);
    const [row] = await scope.tx
      .insert(progressUpdates)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        title: input.title.trim(),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        summary: input.summary?.trim() ?? '',
        percentComplete: input.percentComplete,
        milestones: input.milestones ?? [],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return updateDto(row!);
  }

  async function updateUpdate(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    patch: UpdateOwnerProgressUpdateRequest,
  ) {
    const current = await getUpdate(scope, projectId, id);
    if (current.status === 'published') throw new AppError('ownerportal.update_published');
    if (current.version !== expected) throw versionConflict();
    checkPeriod(patch.periodStart ?? current.periodStart, patch.periodEnd ?? current.periodEnd);
    const [row] = await scope.tx
      .update(progressUpdates)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.periodStart !== undefined ? { periodStart: patch.periodStart } : {}),
        ...(patch.periodEnd !== undefined ? { periodEnd: patch.periodEnd } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary.trim() } : {}),
        ...(patch.percentComplete !== undefined ? { percentComplete: patch.percentComplete } : {}),
        ...(patch.milestones !== undefined ? { milestones: patch.milestones } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(progressUpdates.id, id), eq(progressUpdates.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return updateDto(row);
  }

  async function publishUpdate(scope: TenantScope, projectId: string, id: string) {
    const current = await getUpdate(scope, projectId, id);
    if (current.status === 'published') throw new AppError('ownerportal.update_published');
    const [row] = await scope.tx
      .update(progressUpdates)
      .set({
        status: 'published',
        publishedAt: now(),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(progressUpdates.id, id), eq(progressUpdates.status, 'draft')))
      .returning();
    if (!row) throw new AppError('ownerportal.update_published');
    scope.events.add({
      type: 'ownerportal.progress_update.published.v1',
      entityType: 'owner_progress_update',
      entityId: row.id,
      entityVersion: row.version,
      data: { actorId: scope.ctx.userId },
    });
    return updateDto(row);
  }

  // ------------------------------------------------------------- approvals

  async function listApprovals(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select()
      .from(approvals)
      .where(eq(approvals.projectId, projectId))
      .orderBy(desc(approvals.number));
    return { data: rows.map(approvalDto) };
  }

  async function getApproval(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('ownerportal.approval_not_found');
    return row;
  }

  async function createApproval(
    scope: TenantScope,
    projectId: string,
    input: CreateOwnerApprovalRequest,
  ) {
    await deps.platform.getProject(scope, projectId);
    const [row] = await scope.tx
      .insert(approvals)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        number: await nextNumber(scope, projectId, 'owner_approval'),
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        amountCents: input.amountCents ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'ownerportal.approval.requested.v1',
      entityType: 'owner_approval',
      entityId: row!.id,
      entityVersion: row!.version,
      data: { actorId: scope.ctx.userId },
    });
    return approvalDto(row!);
  }

  async function decide(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: DecideOwnerApprovalRequest,
  ) {
    const current = await getApproval(scope, projectId, id);
    if (current.status !== 'requested') throw new AppError('ownerportal.approval_decided');
    if (current.createdBy && current.createdBy === scope.ctx.userId)
      throw new AppError('ownerportal.own_request');
    const [row] = await scope.tx
      .update(approvals)
      .set({
        status: input.decision,
        decidedBy: scope.ctx.userId,
        decidedAt: now(),
        decisionNote: input.note?.trim() || null,
        version: current.version + 1,
        updatedAt: now(),
      })
      .where(and(eq(approvals.id, id), eq(approvals.status, 'requested')))
      .returning();
    if (!row) throw new AppError('ownerportal.approval_decided');
    scope.events.add({
      type: `ownerportal.approval.${input.decision}.v1`,
      entityType: 'owner_approval',
      entityId: row.id,
      entityVersion: row.version,
      data: { actorId: scope.ctx.userId },
    });
    return approvalDto(row);
  }

  async function withdraw(scope: TenantScope, projectId: string, id: string) {
    const current = await getApproval(scope, projectId, id);
    if (current.status !== 'requested') throw new AppError('ownerportal.approval_decided');
    const [row] = await scope.tx
      .update(approvals)
      .set({ status: 'withdrawn', version: current.version + 1, updatedAt: now() })
      .where(and(eq(approvals.id, id), eq(approvals.status, 'requested')))
      .returning();
    if (!row) throw new AppError('ownerportal.approval_decided');
    return approvalDto(row);
  }

  // ---------------------------------------------------------- capital plan

  async function plan(scope: TenantScope, projectId: string): Promise<OwnerCapitalPlan> {
    const rows = await scope.tx
      .select()
      .from(capitalItems)
      .where(and(eq(capitalItems.projectId, projectId), isNull(capitalItems.deletedAt)))
      .orderBy(
        asc(capitalItems.fiscalYear),
        asc(capitalItems.category),
        asc(capitalItems.createdAt),
      );
    return { items: rows.map(itemDto), totals: capitalTotals(rows) };
  }

  async function getItem(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(capitalItems)
      .where(
        and(
          eq(capitalItems.id, id),
          eq(capitalItems.projectId, projectId),
          isNull(capitalItems.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('ownerportal.item_not_found');
    return row;
  }

  async function createItem(scope: TenantScope, projectId: string, input: OwnerCapitalItemInput) {
    await deps.platform.getProject(scope, projectId);
    const [row] = await scope.tx
      .insert(capitalItems)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        fiscalYear: input.fiscalYear,
        category: input.category.trim(),
        description: input.description?.trim() ?? '',
        budgetCents: input.budgetCents,
        forecastCents: input.forecastCents,
        spentCents: input.spentCents ?? 0,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return itemDto(row!);
  }

  async function updateItem(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    patch: UpdateOwnerCapitalItemRequest,
  ) {
    const current = await getItem(scope, projectId, id);
    if (current.version !== expected) throw versionConflict();
    const [row] = await scope.tx
      .update(capitalItems)
      .set({
        ...(patch.fiscalYear !== undefined ? { fiscalYear: patch.fiscalYear } : {}),
        ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.budgetCents !== undefined ? { budgetCents: patch.budgetCents } : {}),
        ...(patch.forecastCents !== undefined ? { forecastCents: patch.forecastCents } : {}),
        ...(patch.spentCents !== undefined ? { spentCents: patch.spentCents } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(capitalItems.id, id), eq(capitalItems.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return itemDto(row);
  }

  async function removeItem(scope: TenantScope, projectId: string, id: string) {
    await getItem(scope, projectId, id);
    await scope.tx
      .update(capitalItems)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(eq(capitalItems.id, id));
  }

  return {
    ref,
    listUpdates,
    createUpdate,
    updateUpdate,
    publishUpdate,
    listApprovals,
    createApproval,
    decide,
    withdraw,
    plan,
    createItem,
    updateItem,
    removeItem,
  };
}

export type OwnerPortalService = ReturnType<typeof createOwnerPortalService>;
