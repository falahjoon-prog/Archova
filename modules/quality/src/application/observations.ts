import { and, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
  canSeeObservation,
  observationTransition,
  type ObservationAction,
  type ObservationStatus,
  type ObservationType,
  type ObservationViewer,
} from '../domain/observation';
import { inspectionLabel } from '../domain/inspection';
import { observationDraft } from '../domain/item-activity';
import {
  inspections,
  itemEvents,
  observations,
  responses,
  templateItems,
  type Priority,
} from '../infra/tables';
import { checkFiles, liveObservation, requireInternal, viewerOf, type QualityDeps } from './shared';

export type ObservationRow = typeof observations.$inferSelect;
export type ObservationView = ObservationRow & { isOverdue: boolean };

export interface ObservationFields {
  type?: ObservationType;
  hazard?: string | null;
  description?: string;
  location?: string | null;
  priority?: Priority;
  assigneeCompanyId?: string | null;
  dueDate?: string | null;
  swmsId?: string | null;
  fileIds?: string[];
  /** Set when it is raised from a checklist item; the inspection and the item it came from. */
  inspectionId?: string;
  inspectionItemId?: string;
}

export function createObservationService(deps: QualityDeps) {
  const now = deps.now ?? (() => new Date());

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  const view = (r: ObservationRow, localToday: string): ObservationView => ({
    ...r,
    isOverdue: r.status === 'open' && r.dueDate !== null && r.dueDate < localToday,
  });

  function visibleTo(v: ObservationViewer): SQL | null {
    if (v.isInternal) return null;
    const mine = sql`${observations.createdBy} = ${v.userId}`;
    if (!v.companyId) return mine;
    return sql`(${mine} or ${observations.assigneeCompanyId} = ${v.companyId}
      or ${observations.raisedByCompanyId} = ${v.companyId})`;
  }

  /** What the caller's permissions allow on this project, asked once per request. */
  async function caps(scope: TenantScope, projectId: string) {
    return {
      create: await deps.access.can(scope, 'quality.observations.create', { projectId }),
      close: await deps.access.can(scope, 'quality.observations.close', { projectId }),
    };
  }

  async function checkAssignee(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError(
        'observation.assignee_not_on_project',
        'Assign the observation to a company on this project.',
        [{ path: 'assigneeCompanyId', message: 'Not a company on the project' }],
      );
  }

  async function checkSwms(scope: TenantScope, projectId: string, swmsId: string) {
    if (!(await deps.safety.exists(scope, projectId, swmsId)))
      throw new AppError('swms.not_found', 'That SWMS is not on this project.', [
        { path: 'swmsId', message: 'Not a SWMS on the project' },
      ]);
  }

  async function changed(scope: TenantScope, r: ObservationRow) {
    await scope.recordChange({
      module: 'quality',
      entityType: 'observation',
      entityId: r.id,
      op: 'upsert',
      version: r.version,
      projectId: r.projectId,
      isPrivate: false,
    });
  }

  async function getVisible(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(observations)
      .where(liveObservation(id, projectId))
      .limit(1);
    if (!row) throw new AppError('observation.not_found');
    const v = await viewerOf(deps, scope, projectId);
    if (!canSeeObservation(row, v)) throw new AppError('observation.not_found');
    return {
      observation: view(row, await today(scope, projectId)),
      viewer: v,
      caps: await caps(scope, projectId),
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: ObservationStatus;
      type?: ObservationType;
      assigneeCompanyId?: string;
      priority?: Priority;
      overdue?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const date = await today(scope, projectId);
    const v = await viewerOf(deps, scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(observations.projectId, projectId),
      isNull(observations.deletedAt),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(observations.status, opts.status));
    if (opts.type) conditions.push(eq(observations.type, opts.type));
    if (opts.priority) conditions.push(eq(observations.priority, opts.priority));
    if (opts.assigneeCompanyId)
      conditions.push(eq(observations.assigneeCompanyId, opts.assigneeCompanyId));
    const late = sql`${observations.status} = 'open' and ${observations.dueDate} < ${date}::date`;
    if (opts.overdue === true) conditions.push(late);
    if (opts.overdue === false) conditions.push(sql`not coalesce(${late}, false)`);
    if (after) conditions.push(lt(observations.id, after.id));
    const rows = await scope.tx
      .select()
      .from(observations)
      .where(and(...conditions))
      .orderBy(desc(observations.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    return {
      data: page.data.map((r) => view(r, date)),
      nextCursor: page.nextCursor,
      viewer: v,
      caps: await caps(scope, projectId),
    };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: ObservationFields & { type: ObservationType; description: string },
  ) {
    const v = await viewerOf(deps, scope, projectId);
    await deps.platform.getProject(scope, projectId);
    if (input.assigneeCompanyId) await checkAssignee(scope, projectId, input.assigneeCompanyId);
    if (input.swmsId) await checkSwms(scope, projectId, input.swmsId);
    await checkFiles(deps, scope, projectId, input.fileIds ?? []);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'observation');
    const [row] = await scope.tx
      .insert(observations)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        type: input.type,
        hazard: input.hazard ?? null,
        description: input.description.trim(),
        location: input.location ?? null,
        priority: input.priority ?? 'medium',
        assigneeCompanyId: input.assigneeCompanyId ?? null,
        raisedByCompanyId: v.companyId,
        dueDate: input.dueDate ?? null,
        swmsId: input.swmsId ?? null,
        inspectionId: input.inspectionId ?? null,
        inspectionItemId: input.inspectionItemId ?? null,
        fileIds: [...new Set(input.fileIds ?? [])],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await changed(scope, row!);
    scope.events.add({
      type: 'quality.observation.created.v1',
      projectId,
      entityType: 'observation',
      entityId: id,
      entityVersion: 1,
      data: {
        observationId: id,
        number,
        type: input.type,
        assigneeCompanyId: row!.assigneeCompanyId,
      },
    });
    return getVisible(scope, projectId, id);
  }

  /**
   * "Create Observation" on a checklist line: starts from the item (its question, answer, latest comment and
   * photos) and lets the person override anything. The item's activity records that it was raised.
   */
  async function createFromItem(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
    templateItemId: string,
    input: Partial<Omit<ObservationFields, 'inspectionId' | 'inspectionItemId'>> & {
      comment?: string;
    },
  ) {
    await requireInternal(deps, scope, projectId, 'inspection.not_found');
    const [inspection] = await scope.tx
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.id, inspectionId),
          eq(inspections.projectId, projectId),
          isNull(inspections.deletedAt),
        ),
      )
      .limit(1);
    if (!inspection) throw new AppError('inspection.not_found');
    const [item] = await scope.tx
      .select()
      .from(templateItems)
      .where(
        and(
          eq(templateItems.id, templateItemId),
          eq(templateItems.templateId, inspection.templateId),
        ),
      )
      .limit(1);
    if (!item)
      throw new AppError('inspection.invalid_response', 'That item is not on this checklist.', [
        { path: 'templateItemId', message: 'Not on this checklist' },
      ]);
    const [answer] = await scope.tx
      .select()
      .from(responses)
      .where(
        and(eq(responses.inspectionId, inspectionId), eq(responses.templateItemId, templateItemId)),
      )
      .limit(1);
    const comment = input.comment ?? answer?.note ?? null;
    const created = await create(scope, projectId, {
      ...input,
      type: input.type ?? 'quality',
      description:
        input.description ??
        observationDraft({
          inspectionLabel: inspectionLabel(inspection.number),
          itemPrompt: item.prompt,
          result: answer?.result ?? null,
          comment,
        }),
      location: input.location ?? inspection.location,
      priority: input.priority ?? (answer?.result === 'fail' ? 'high' : 'medium'),
      fileIds: input.fileIds ?? answer?.fileIds ?? [],
      inspectionId,
      inspectionItemId: templateItemId,
    });
    await scope.tx.insert(itemEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      inspectionId,
      templateItemId,
      kind: 'observation',
      observationId: created.observation.id,
      actorId: scope.ctx.userId,
      at: now(),
    });
    return created;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: ObservationFields,
  ) {
    const { observation, viewer } = await getVisible(scope, projectId, id);
    if (observation.status === 'closed')
      throw new AppError(
        'observation.invalid_transition',
        "A closed observation can't be edited.",
        undefined,
        {
          status: observation.status,
        },
      );
    if (!viewer.isInternal && observation.createdBy !== viewer.userId)
      throw new AppError('access.denied', "You can't change this observation.");
    if (observation.version !== expectedVersion) throw versionConflict();
    if (patch.assigneeCompanyId) await checkAssignee(scope, projectId, patch.assigneeCompanyId);
    if (patch.swmsId) await checkSwms(scope, projectId, patch.swmsId);
    if (patch.fileIds) await checkFiles(deps, scope, projectId, patch.fileIds);
    const [row] = await scope.tx
      .update(observations)
      .set({
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.hazard !== undefined ? { hazard: patch.hazard } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.assigneeCompanyId !== undefined
          ? { assigneeCompanyId: patch.assigneeCompanyId }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.swmsId !== undefined ? { swmsId: patch.swmsId } : {}),
        ...(patch.fileIds !== undefined ? { fileIds: [...new Set(patch.fileIds)] } : {}),
        version: observation.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(observations.id, id), eq(observations.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    return getVisible(scope, projectId, id);
  }

  const permissionFor = (a: ObservationAction) =>
    a === 'close' || a === 'reopen' ? 'quality.observations.close' : 'quality.observations.create';

  /** resolve, close, reopen and stopWork. Only the builder or the assigned company may resolve (OBS rules). */
  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: ObservationAction; reason?: string; fileIds?: string[]; swmsId?: string },
  ) {
    const { observation, viewer, caps: c } = await getVisible(scope, projectId, id);
    if (!(permissionFor(input.action) === 'quality.observations.close' ? c.close : c.create))
      throw new AppError('access.denied', `You can't ${input.action} this observation.`);
    const assigned =
      viewer.companyId !== null && observation.assigneeCompanyId === viewer.companyId;
    if (input.action === 'resolve' && !viewer.isInternal && !assigned)
      throw new AppError('observation.not_allowed', 'Only the assigned company can resolve this.');
    const result = observationTransition(observation.status, input.action, input.reason ?? null);
    if (!result.ok)
      throw new AppError(
        result.code,
        result.code === 'observation.reason_required'
          ? 'Give a reason.'
          : `An observation that is ${observation.status} can't be ${input.action === 'close' ? 'closed' : input.action === 'resolve' ? 'resolved' : input.action}.`,
        result.code === 'observation.reason_required'
          ? [{ path: 'reason', message: 'Required' }]
          : undefined,
        { status: observation.status },
      );
    if (observation.version !== expectedVersion) throw versionConflict();
    const swmsId = input.swmsId ?? observation.swmsId;
    if (input.action === 'stopWork') {
      if (observation.type !== 'safety' || !swmsId)
        throw new AppError(
          'validation_failed',
          'Stop work needs a safety observation linked to the SWMS that was not followed.',
          [{ path: 'swmsId', message: 'Required for stop work' }],
        );
      await checkSwms(scope, projectId, swmsId);
    }
    if (input.fileIds) await checkFiles(deps, scope, projectId, input.fileIds);
    const at = now();
    const [row] = await scope.tx
      .update(observations)
      .set({
        status: result.to,
        ...(input.action === 'resolve'
          ? {
              resolvedAt: at,
              resolutionNote: input.reason ?? null,
              fileIds: [...new Set([...observation.fileIds, ...(input.fileIds ?? [])])],
            }
          : {}),
        ...(input.action === 'close' ? { closedAt: at, closedBy: scope.ctx.userId } : {}),
        ...(input.action === 'reopen' ? { resolvedAt: null, closedAt: null, closedBy: null } : {}),
        ...(input.action === 'stopWork' ? { swmsId } : {}),
        version: observation.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(observations.id, id), eq(observations.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    if (input.action === 'stopWork')
      await deps.safety.reopenForReview(
        scope,
        projectId,
        swmsId!,
        `Stop work from ${`OBS-${String(observation.number).padStart(4, '0')}`}: ${input.reason}`,
      );
    await changed(scope, row);
    scope.events.add({
      type: `quality.observation.${input.action}.v1`,
      projectId,
      entityType: 'observation',
      entityId: id,
      entityVersion: row.version,
      data: { observationId: id, from: observation.status, to: row.status, swmsId: row.swmsId },
    });
    return getVisible(scope, projectId, id);
  }

  return { list, create, createFromItem, detail: getVisible, update, transition };
}

export type ObservationService = ReturnType<typeof createObservationService>;
