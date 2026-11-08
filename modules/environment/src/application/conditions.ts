import { and, asc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
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
  availableConditionActions,
  conditionTransition,
  EVENT_ACTION,
  nextDueDate,
  type ConditionAction,
  type ConditionCategory,
  type ConditionFrequency,
  type ConditionSource,
  type ConditionStatus,
} from '../domain/condition';
import { STARTER_CONDITIONS } from '../domain/starter-pack';
import { conditionEvents, conditions } from '../infra/tables';
import { checkFiles, projectToday, type EnvironmentDeps } from './shared';

export type ConditionRow = typeof conditions.$inferSelect;
export type ConditionEventRow = typeof conditionEvents.$inferSelect;
export type ConditionView = ConditionRow & {
  isOverdue: boolean;
  availableActions: ConditionAction[];
};

export interface ConditionFields {
  title?: string;
  requirement?: string | null;
  category?: ConditionCategory;
  source?: ConditionSource;
  sourceReference?: string | null;
  frequency?: ConditionFrequency;
  responsibleCompanyId?: string | null;
  responsibleUserId?: string | null;
  dueDate?: string | null;
  fileIds?: string[];
}

export function createConditionService(deps: EnvironmentDeps) {
  const now = deps.now ?? (() => new Date());

  async function caps(scope: TenantScope, projectId: string) {
    return {
      update: await deps.access.can(scope, 'environment.conditions.manage', { projectId }),
      signOff: await deps.access.can(scope, 'environment.conditions.signoff', { projectId }),
    };
  }

  async function view(
    scope: TenantScope,
    projectId: string,
    rows: ConditionRow[],
  ): Promise<ConditionView[]> {
    const today = await projectToday(deps, scope, projectId);
    const c = await caps(scope, projectId);
    return rows.map((r) => ({
      ...r,
      isOverdue: r.status !== 'not_applicable' && r.dueDate !== null && r.dueDate < today,
      availableActions: availableConditionActions(r, c),
    }));
  }

  async function checkResponsible(
    scope: TenantScope,
    projectId: string,
    companyId: string | null | undefined,
  ) {
    if (!companyId) return;
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError(
        'environment.company_not_on_project',
        'Assign the condition to a company on this project.',
        [{ path: 'responsibleCompanyId', message: 'Not a company on the project' }],
      );
  }

  const live = (projectId: string, id: string) =>
    and(eq(conditions.id, id), eq(conditions.projectId, projectId), isNull(conditions.deletedAt));

  async function row(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx.select().from(conditions).where(live(projectId, id)).limit(1);
    if (!r) throw new AppError('environment.condition_not_found');
    return r;
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const r = await row(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(conditionEvents)
      .where(and(eq(conditionEvents.conditionId, id), eq(conditionEvents.projectId, projectId)))
      .orderBy(asc(conditionEvents.at), asc(conditionEvents.id));
    return { condition: (await view(scope, projectId, [r]))[0]!, events };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: ConditionStatus;
      category?: ConditionCategory;
      source?: ConditionSource;
      overdue?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const today = await projectToday(deps, scope, projectId);
    const after = decodeCursor<{ n: number }>(opts.cursor);
    const where: SQL[] = [eq(conditions.projectId, projectId), isNull(conditions.deletedAt)];
    if (opts.status) where.push(eq(conditions.status, opts.status));
    if (opts.category) where.push(eq(conditions.category, opts.category));
    if (opts.source) where.push(eq(conditions.source, opts.source));
    const late = sql`${conditions.status} <> 'not_applicable' and ${conditions.dueDate} < ${today}::date`;
    if (opts.overdue === true) where.push(late);
    if (opts.overdue === false) where.push(sql`not coalesce(${late}, false)`);
    if (after) where.push(gt(conditions.number, after.n));
    const rows = await scope.tx
      .select()
      .from(conditions)
      .where(and(...where))
      .orderBy(asc(conditions.number))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ n: r.number }));
    return { data: await view(scope, projectId, page.data), nextCursor: page.nextCursor };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: ConditionFields & {
      title: string;
      category: ConditionCategory;
    },
  ) {
    await deps.platform.getProject(scope, projectId);
    await checkResponsible(scope, projectId, input.responsibleCompanyId);
    await checkFiles(deps, scope, projectId, input.fileIds ?? []);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'environment_condition');
    await scope.tx.insert(conditions).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number,
      title: input.title.trim(),
      requirement: input.requirement ?? null,
      category: input.category,
      source: input.source ?? 'other',
      sourceReference: input.sourceReference ?? null,
      frequency: input.frequency ?? 'once',
      responsibleCompanyId: input.responsibleCompanyId ?? null,
      responsibleUserId: input.responsibleUserId ?? null,
      dueDate: input.dueDate ?? null,
      fileIds: [...new Set(input.fileIds ?? [])],
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return detail(scope, projectId, id);
  }

  /**
   * Loads the standard Australian-construction conditions into the register. A condition whose title is already
   * there (case-insensitive) is skipped, so applying the pack twice adds nothing.
   */
  async function applyStarterPack(scope: TenantScope, projectId: string) {
    await deps.platform.getProject(scope, projectId);
    const have = await scope.tx
      .select({ title: conditions.title })
      .from(conditions)
      .where(and(eq(conditions.projectId, projectId), isNull(conditions.deletedAt)));
    const titles = new Set(have.map((h) => h.title.toLowerCase()));
    const created: ConditionRow[] = [];
    for (const s of STARTER_CONDITIONS) {
      if (titles.has(s.title.toLowerCase())) continue;
      const id = uuidv7();
      const number = await nextNumber(scope, projectId, 'environment_condition');
      const [r] = await scope.tx
        .insert(conditions)
        .values({
          id,
          orgId: scope.ctx.orgId,
          projectId,
          number,
          title: s.title,
          requirement: s.requirement,
          category: s.category,
          source: s.source,
          frequency: s.frequency,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      created.push(r!);
    }
    return {
      created: await view(scope, projectId, created),
      skipped: STARTER_CONDITIONS.length - created.length,
    };
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: ConditionFields,
  ) {
    const current = await row(scope, projectId, id);
    if (current.version !== expectedVersion) throw versionConflict();
    if (patch.responsibleCompanyId !== undefined)
      await checkResponsible(scope, projectId, patch.responsibleCompanyId);
    if (patch.fileIds) await checkFiles(deps, scope, projectId, patch.fileIds);
    const [r] = await scope.tx
      .update(conditions)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.requirement !== undefined ? { requirement: patch.requirement } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.sourceReference !== undefined ? { sourceReference: patch.sourceReference } : {}),
        ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
        ...(patch.responsibleCompanyId !== undefined
          ? { responsibleCompanyId: patch.responsibleCompanyId }
          : {}),
        ...(patch.responsibleUserId !== undefined
          ? { responsibleUserId: patch.responsibleUserId }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.fileIds !== undefined ? { fileIds: [...new Set(patch.fileIds)] } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(conditions.id, id), eq(conditions.version, expectedVersion)))
      .returning();
    if (!r) throw versionConflict();
    return detail(scope, projectId, id);
  }

  /** start, signOff, flagNonCompliant, markNotApplicable and reopen. Each leaves a row in the sign-off trail. */
  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: ConditionAction; note?: string; fileIds?: string[] },
  ) {
    const current = await row(scope, projectId, id);
    const c = await caps(scope, projectId);
    const allowed = availableConditionActions(current, c);
    const result = conditionTransition(
      current.status,
      input.action,
      current.frequency,
      input.note ?? null,
    );
    if (!result.ok)
      throw new AppError(
        result.code,
        result.code === 'environment.reason_required'
          ? 'Give a reason.'
          : `A condition that is ${current.status.replace('_', ' ')} can't be ${input.action}.`,
        result.code === 'environment.reason_required'
          ? [{ path: 'note', message: 'Required' }]
          : undefined,
        { status: current.status },
      );
    if (!allowed.includes(input.action))
      throw new AppError('access.denied', `You can't ${input.action} this condition.`);
    if (current.version !== expectedVersion) throw versionConflict();
    if (input.fileIds) await checkFiles(deps, scope, projectId, input.fileIds);
    const evidence = [...new Set([...(input.fileIds ?? [])])];
    // Signing off needs something to stand behind: evidence, a note, or evidence already on the condition.
    if (
      input.action === 'signOff' &&
      evidence.length === 0 &&
      !input.note?.trim() &&
      current.fileIds.length === 0
    )
      throw new AppError('validation_failed', 'Attach evidence or add a note to sign off.', [
        { path: 'note', message: 'Evidence or a note is required' },
      ]);
    const at = now();
    const today = await projectToday(deps, scope, projectId);
    const signedOff = input.action === 'signOff';
    const [r] = await scope.tx
      .update(conditions)
      .set({
        status: result.to,
        ...(signedOff
          ? {
              lastReviewedOn: today,
              // A recurring check rolls to its next date; a one-off has nothing left to do.
              dueDate: nextDueDate(current.frequency, today),
            }
          : {}),
        ...(evidence.length > 0
          ? { fileIds: [...new Set([...current.fileIds, ...evidence])] }
          : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(conditions.id, id), eq(conditions.version, expectedVersion)))
      .returning();
    if (!r) throw versionConflict();
    await scope.tx.insert(conditionEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      conditionId: id,
      action: EVENT_ACTION[input.action],
      fromStatus: current.status,
      toStatus: result.to,
      note: input.note?.trim() || null,
      fileIds: evidence,
      actorId: scope.ctx.userId,
      at,
    });
    scope.events.add({
      type: `environment.condition.${EVENT_ACTION[input.action]}.v1`,
      projectId,
      entityType: 'environment_condition',
      entityId: id,
      entityVersion: r.version,
      data: {
        conditionId: id,
        number: r.number,
        from: current.status,
        to: r.status,
        category: r.category,
      },
    });
    return detail(scope, projectId, id);
  }

  /**
   * A monitoring breach on a point linked to this condition flags it non-compliant, leaving a row in the trail.
   * Done on the system's behalf (no permission check: the person logging the reading is not signing anything off);
   * a condition already flagged or not applicable is left alone.
   */
  async function flagFromBreach(
    scope: TenantScope,
    projectId: string,
    id: string,
    note: string,
    fileIds: string[] = [],
  ) {
    const [current] = await scope.tx.select().from(conditions).where(live(projectId, id)).limit(1);
    if (!current || current.status === 'non_compliant' || current.status === 'not_applicable')
      return;
    const at = now();
    await scope.tx
      .update(conditions)
      .set({
        status: 'non_compliant',
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(conditions.id, id), eq(conditions.version, current.version)));
    await scope.tx.insert(conditionEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      conditionId: id,
      action: EVENT_ACTION.flagNonCompliant,
      fromStatus: current.status,
      toStatus: 'non_compliant',
      note,
      fileIds,
      actorId: scope.ctx.userId,
      at,
    });
  }

  /** Every live condition's roll-up fields, for the summary and Nova's flags. */
  async function allForSummary(scope: TenantScope, projectId: string) {
    return scope.tx
      .select({
        id: conditions.id,
        number: conditions.number,
        status: conditions.status,
        category: conditions.category,
        dueDate: conditions.dueDate,
      })
      .from(conditions)
      .where(and(eq(conditions.projectId, projectId), isNull(conditions.deletedAt)));
  }

  return {
    list,
    create,
    detail,
    update,
    transition,
    applyStarterPack,
    allForSummary,
    flagFromBreach,
    caps,
  };
}

export type ConditionService = ReturnType<typeof createConditionService>;
