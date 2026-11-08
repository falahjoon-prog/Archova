import { and, asc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import {
  CONDITION_CATEGORIES,
  CONDITION_STATUSES,
  isConditionOverdue,
  type ConditionCategory,
  type ConditionStatus,
} from '../domain/condition';
import { expiryState, type DocumentType } from '../domain/document';
import { environmentFlags } from '../domain/flags';
import { documents, plans } from '../infra/tables';
import type { ConditionService } from './conditions';
import { checkFiles, projectToday, type EnvironmentDeps } from './shared';

export type PlanRow = typeof plans.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

export interface PlanFields {
  title?: string;
  permitReference?: string | null;
  summary?: string | null;
  reviewIntervalMonths?: number;
  nextReviewDate?: string | null;
}

export interface DocumentFields {
  title?: string;
  docType?: DocumentType;
  reference?: string | null;
  fileId?: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
}

/** `date` plus a number of calendar months, clamped to the end of a shorter month (31 Aug + 6 = 28 Feb). */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export function createRegisterService(deps: EnvironmentDeps, conditions: ConditionService) {
  const now = deps.now ?? (() => new Date());

  // ---- plan -------------------------------------------------------------------------------------------------

  async function getPlan(scope: TenantScope, projectId: string): Promise<PlanRow | null> {
    const [r] = await scope.tx.select().from(plans).where(eq(plans.projectId, projectId)).limit(1);
    return r ?? null;
  }

  /** Creates the project's one EMP (`expectedVersion` null) or edits it. A plan edited after approval stays approved. */
  async function upsertPlan(
    scope: TenantScope,
    projectId: string,
    expectedVersion: number | null,
    patch: PlanFields,
  ) {
    await deps.platform.getProject(scope, projectId);
    const current = await getPlan(scope, projectId);
    if (expectedVersion !== null && !current) throw new AppError('environment.plan_not_found');
    if (expectedVersion === null && current) throw new AppError('environment.plan_exists');
    if (!current) {
      if (!patch.title?.trim())
        throw new AppError('validation_failed', 'Name the plan.', [
          { path: 'title', message: 'Required' },
        ]);
      const [r] = await scope.tx
        .insert(plans)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          title: patch.title.trim(),
          permitReference: patch.permitReference ?? null,
          summary: patch.summary ?? null,
          reviewIntervalMonths: patch.reviewIntervalMonths ?? 6,
          nextReviewDate: patch.nextReviewDate ?? null,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return r!;
    }
    if (current.version !== expectedVersion) throw versionConflict();
    const [r] = await scope.tx
      .update(plans)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.permitReference !== undefined ? { permitReference: patch.permitReference } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.reviewIntervalMonths !== undefined
          ? { reviewIntervalMonths: patch.reviewIntervalMonths }
          : {}),
        ...(patch.nextReviewDate !== undefined ? { nextReviewDate: patch.nextReviewDate } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(plans.id, current.id), eq(plans.version, expectedVersion)))
      .returning();
    if (!r) throw versionConflict();
    return r;
  }

  /** Approving makes the EMP active and sets the next review a review-interval from today. */
  async function approvePlan(scope: TenantScope, projectId: string, expectedVersion: number) {
    const current = await getPlan(scope, projectId);
    if (!current) throw new AppError('environment.plan_not_found');
    if (current.version !== expectedVersion) throw versionConflict();
    const today = await projectToday(deps, scope, projectId);
    const [r] = await scope.tx
      .update(plans)
      .set({
        status: 'active',
        approvedAt: now(),
        approvedBy: scope.ctx.userId,
        nextReviewDate: addMonths(today, current.reviewIntervalMonths),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(plans.id, current.id), eq(plans.version, expectedVersion)))
      .returning();
    if (!r) throw versionConflict();
    return r;
  }

  // ---- documents --------------------------------------------------------------------------------------------

  const liveDoc = (projectId: string, id: string) =>
    and(eq(documents.id, id), eq(documents.projectId, projectId), isNull(documents.deletedAt));

  async function docRow(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx.select().from(documents).where(liveDoc(projectId, id)).limit(1);
    if (!r) throw new AppError('environment.document_not_found');
    return r;
  }

  async function listDocuments(scope: TenantScope, projectId: string, docType?: DocumentType) {
    const today = await projectToday(deps, scope, projectId);
    const rows = await scope.tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.projectId, projectId),
          isNull(documents.deletedAt),
          ...(docType ? [eq(documents.docType, docType)] : []),
        ),
      )
      .orderBy(asc(documents.docType), asc(documents.title));
    return rows.map((r) => ({ ...r, expiry: expiryState(r.expiresOn, today) }));
  }

  async function createDocument(
    scope: TenantScope,
    projectId: string,
    input: DocumentFields & { title: string; docType: DocumentType; fileId: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    await checkFiles(deps, scope, projectId, [input.fileId], 'fileId');
    const [r] = await scope.tx
      .insert(documents)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        title: input.title.trim(),
        docType: input.docType,
        reference: input.reference ?? null,
        fileId: input.fileId,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return { ...r!, expiry: expiryState(r!.expiresOn, await projectToday(deps, scope, projectId)) };
  }

  async function updateDocument(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: DocumentFields,
  ) {
    const current = await docRow(scope, projectId, id);
    if (current.version !== expectedVersion) throw versionConflict();
    if (patch.fileId) await checkFiles(deps, scope, projectId, [patch.fileId], 'fileId');
    const [r] = await scope.tx
      .update(documents)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.docType !== undefined ? { docType: patch.docType } : {}),
        ...(patch.reference !== undefined ? { reference: patch.reference } : {}),
        ...(patch.fileId !== undefined ? { fileId: patch.fileId } : {}),
        ...(patch.issuedOn !== undefined ? { issuedOn: patch.issuedOn } : {}),
        ...(patch.expiresOn !== undefined ? { expiresOn: patch.expiresOn } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(documents.id, id), eq(documents.version, expectedVersion)))
      .returning();
    if (!r) throw versionConflict();
    return { ...r, expiry: expiryState(r.expiresOn, await projectToday(deps, scope, projectId)) };
  }

  async function deleteDocument(scope: TenantScope, projectId: string, id: string) {
    await docRow(scope, projectId, id);
    await scope.tx
      .update(documents)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId })
      .where(liveDoc(projectId, id));
  }

  // ---- summary ----------------------------------------------------------------------------------------------

  /** The register at a glance, plus the rule-based flags Nova raises over it (no model, no credit cost). */
  async function summary(scope: TenantScope, projectId: string) {
    const today = await projectToday(deps, scope, projectId);
    const [plan, conds, docs] = await Promise.all([
      getPlan(scope, projectId),
      conditions.allForSummary(scope, projectId),
      scope.tx
        .select({ id: documents.id, title: documents.title, expiresOn: documents.expiresOn })
        .from(documents)
        .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt))),
    ]);
    const byStatus = Object.fromEntries(CONDITION_STATUSES.map((s) => [s, 0])) as Record<
      ConditionStatus,
      number
    >;
    const byCategory = new Map<
      ConditionCategory,
      { total: number; compliant: number; nonCompliant: number; overdue: number }
    >(
      CONDITION_CATEGORIES.map((c) => [c, { total: 0, compliant: 0, nonCompliant: 0, overdue: 0 }]),
    );
    let overdue = 0;
    for (const c of conds) {
      byStatus[c.status] += 1;
      const cat = byCategory.get(c.category)!;
      cat.total += 1;
      if (c.status === 'compliant') cat.compliant += 1;
      if (c.status === 'non_compliant') cat.nonCompliant += 1;
      if (isConditionOverdue(c, today)) {
        overdue += 1;
        cat.overdue += 1;
      }
    }
    const applicable = conds.length - byStatus.not_applicable;
    return {
      today,
      plan,
      conditions: {
        total: conds.length,
        byStatus,
        overdue,
        // Share of applicable conditions currently signed off; null until there is something to measure.
        compliancePercent:
          applicable === 0 ? null : Math.round((byStatus.compliant / applicable) * 100),
        byCategory: [...byCategory.entries()]
          .filter(([, v]) => v.total > 0)
          .map(([category, v]) => ({ category, ...v })),
      },
      documents: {
        total: docs.length,
        expired: docs.filter((d) => expiryState(d.expiresOn, today) === 'expired').length,
        expiring: docs.filter((d) => expiryState(d.expiresOn, today) === 'expiring').length,
      },
      flags: environmentFlags({
        today,
        plan: plan ? { status: plan.status, nextReviewDate: plan.nextReviewDate } : null,
        conditions: conds,
        documents: docs,
      }),
    };
  }

  return {
    getPlan,
    upsertPlan,
    approvePlan,
    listDocuments,
    createDocument,
    updateDocument,
    deleteDocument,
    summary,
  };
}

export type RegisterService = ReturnType<typeof createRegisterService>;
