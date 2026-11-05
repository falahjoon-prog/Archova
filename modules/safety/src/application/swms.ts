import { and, asc, count, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  SWMS_ACTIONS,
  isExpired,
  swmsAdvisories,
  swmsGaps,
  swmsTransition,
  type SwmsAction,
  type SwmsContent,
  type SwmsStatus,
} from '../domain/swms';
import { acknowledgements, swms, swmsEvents } from '../infra/tables';

export type SwmsRow = typeof swms.$inferSelect;
export type SwmsEventRow = typeof swmsEvents.$inferSelect;
export type SwmsView = SwmsRow & { isExpired: boolean };

export interface SafetyDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface SwmsFields {
  title?: string;
  companyId?: string | null;
  highRiskWorkCategories?: string[];
  content?: SwmsContent;
  fileId?: string | null;
  expiresOn?: string | null;
}

interface Viewer {
  userId: string;
  companyId: string | null;
  isInternal: boolean;
}

export function createSwmsService(deps: SafetyDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewerOf(scope: TenantScope, projectId: string): Promise<Viewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  const view = (r: SwmsRow, localToday: string): SwmsView => ({
    ...r,
    isExpired: isExpired(r.expiresOn, localToday),
  });

  const canSee = (r: SwmsRow, v: Viewer) =>
    v.isInternal ||
    r.createdBy === v.userId ||
    (v.companyId !== null && r.companyId === v.companyId);

  function visibleTo(v: Viewer): SQL | null {
    if (v.isInternal) return null;
    const mine = sql`${swms.createdBy} = ${v.userId}`;
    return v.companyId ? sql`(${mine} or ${swms.companyId} = ${v.companyId})` : mine;
  }

  async function checkCompany(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError('validation_failed', 'Name a company on this project.', [
        { path: 'companyId', message: 'Not a company on the project' },
      ]);
  }

  async function checkFile(scope: TenantScope, projectId: string, fileId: string) {
    const f = await deps.files.getFile(scope, fileId);
    if (f.projectId !== projectId || f.status !== 'ready')
      throw new AppError('file.not_in_project', 'Attach a file uploaded to this project.', [
        { path: 'fileId', message: 'Not a ready file in this project' },
      ]);
  }

  async function record(
    scope: TenantScope,
    row: SwmsRow,
    e: { action: string; from: SwmsStatus | null; note?: string | null },
  ) {
    await scope.tx.insert(swmsEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      swmsId: row.id,
      action: e.action,
      fromStatus: e.from,
      toStatus: row.status,
      revision: row.revision,
      note: e.note ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function changed(scope: TenantScope, r: SwmsRow) {
    await scope.recordChange({
      module: 'safety',
      entityType: 'swms',
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
      .from(swms)
      .where(and(eq(swms.id, id), eq(swms.projectId, projectId), isNull(swms.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('swms.not_found');
    const v = await viewerOf(scope, projectId);
    if (!canSee(row, v)) throw new AppError('swms.not_found');
    return { row, viewer: v };
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(swmsEvents)
      .where(eq(swmsEvents.swmsId, id))
      .orderBy(asc(swmsEvents.at), asc(swmsEvents.id));
    const acks = await scope.tx
      .select()
      .from(acknowledgements)
      .where(and(eq(acknowledgements.swmsId, id), eq(acknowledgements.revision, row.revision)))
      .orderBy(asc(acknowledgements.at));
    return {
      swms: view(row, await today(scope, projectId)),
      events,
      acknowledgements: acks,
      gaps: swmsGaps(row.highRiskWorkCategories, row.content),
      advisories: swmsAdvisories(row.highRiskWorkCategories, row.content),
      availableActions: (await deps.access.can(scope, 'safety.swms.review', { projectId }))
        ? SWMS_ACTIONS.filter((a) => swmsTransition(row.status, a, 'x').ok)
        : [],
      viewer,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: SwmsStatus;
      companyId?: string;
      category?: string;
      expired?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const date = await today(scope, projectId);
    const v = await viewerOf(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(swms.projectId, projectId), isNull(swms.deletedAt)];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(swms.status, opts.status));
    if (opts.companyId) conditions.push(eq(swms.companyId, opts.companyId));
    if (opts.category) conditions.push(sql`${opts.category} = any(${swms.highRiskWorkCategories})`);
    if (opts.expired === true) conditions.push(sql`${swms.expiresOn} < ${date}::date`);
    if (opts.expired === false)
      conditions.push(sql`not coalesce(${swms.expiresOn} < ${date}::date, false)`);
    if (after) conditions.push(lt(swms.id, after.id));
    const rows = await scope.tx
      .select()
      .from(swms)
      .where(and(...conditions))
      .orderBy(desc(swms.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    return { data: page.data.map((r) => view(r, date)), nextCursor: page.nextCursor };
  }

  /** Subcontractors submit for their own company; builder staff may submit for any company on the project. */
  async function create(
    scope: TenantScope,
    projectId: string,
    input: SwmsFields & { title: string },
  ) {
    const v = await viewerOf(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const companyId = v.isInternal ? (input.companyId ?? v.companyId) : v.companyId;
    if (companyId) await checkCompany(scope, projectId, companyId);
    if (input.fileId) await checkFile(scope, projectId, input.fileId);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'swms');
    const [row] = await scope.tx
      .insert(swms)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        title: input.title.trim(),
        companyId,
        highRiskWorkCategories: [...new Set(input.highRiskWorkCategories ?? [])],
        content: input.content ?? {},
        fileId: input.fileId ?? null,
        expiresOn: input.expiresOn ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await record(scope, row!, { action: 'submit', from: null });
    await changed(scope, row!);
    scope.events.add({
      type: 'safety.swms.submitted.v1',
      projectId,
      entityType: 'swms',
      entityId: id,
      entityVersion: 1,
      data: { swmsId: id, number, companyId, categories: row!.highRiskWorkCategories },
    });
    return detail(scope, projectId, id);
  }

  /** Any change starts a new revision and puts the SWMS back in front of the reviewer, whatever it was before. */
  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: SwmsFields,
  ) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    if (!viewer.isInternal && row.createdBy !== viewer.userId && row.companyId !== viewer.companyId)
      throw new AppError('access.denied', "You can't change this SWMS.");
    if (row.version !== expectedVersion) throw versionConflict();
    if (patch.companyId && viewer.isInternal) await checkCompany(scope, projectId, patch.companyId);
    if (patch.fileId) await checkFile(scope, projectId, patch.fileId);
    const [next] = await scope.tx
      .update(swms)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.companyId !== undefined && viewer.isInternal
          ? { companyId: patch.companyId }
          : {}),
        ...(patch.highRiskWorkCategories !== undefined
          ? { highRiskWorkCategories: [...new Set(patch.highRiskWorkCategories)] }
          : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.fileId !== undefined ? { fileId: patch.fileId } : {}),
        ...(patch.expiresOn !== undefined ? { expiresOn: patch.expiresOn } : {}),
        status: 'submitted',
        reviewedBy: null,
        reviewedAt: null,
        revision: row.revision + 1,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(swms.id, id), eq(swms.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, { action: 'revise', from: row.status });
    await changed(scope, next);
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: SwmsAction; reason?: string; confirmedUnderstandable?: boolean },
  ) {
    const { row } = await getVisible(scope, projectId, id);
    if (!(await deps.access.can(scope, 'safety.swms.review', { projectId })))
      throw new AppError('access.denied', `You can't ${input.action} this SWMS.`);
    const result = swmsTransition(row.status, input.action, input.reason ?? null);
    if (!result.ok)
      throw new AppError(
        result.code,
        result.code === 'swms.reason_required'
          ? 'Give a reason.'
          : `A SWMS that is ${row.status} can't be ${input.action}.`,
        result.code === 'swms.reason_required'
          ? [{ path: 'reason', message: 'Required' }]
          : undefined,
        { status: row.status },
      );
    if (row.version !== expectedVersion) throw versionConflict();
    if (input.action === 'accept') {
      const gaps = swmsGaps(row.highRiskWorkCategories, row.content);
      if (gaps.length > 0)
        throw new AppError(
          'swms.incomplete',
          'The SWMS is missing required content, so it can not be accepted.',
          gaps.map((g) => ({ path: g.field, message: g.message })),
        );
      if (input.confirmedUnderstandable !== true)
        throw new AppError(
          'swms.incomplete',
          'Confirm the SWMS is set out so the people who use it can readily understand it.',
          [{ path: 'confirmedUnderstandable', message: 'Required to accept' }],
        );
    }
    const at = now();
    const [next] = await scope.tx
      .update(swms)
      .set({
        status: result.to,
        ...(input.action === 'reopen'
          ? { revision: row.revision + 1, reviewedBy: null, reviewedAt: null }
          : { reviewedBy: scope.ctx.userId, reviewedAt: at }),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(swms.id, id), eq(swms.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, {
      action: input.action,
      from: row.status,
      note: input.reason ?? null,
    });
    await changed(scope, next);
    scope.events.add({
      type: `safety.swms.${input.action}.v1`,
      projectId,
      entityType: 'swms',
      entityId: id,
      entityVersion: next.version,
      data: { swmsId: id, from: row.status, to: next.status, revision: next.revision },
    });
    return detail(scope, projectId, id);
  }

  /** A worker records they have read the accepted revision. Doing it twice is not an error. */
  async function acknowledge(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { workerName: string; language?: string },
  ) {
    const { row } = await getVisible(scope, projectId, id);
    if (row.status !== 'accepted')
      throw new AppError(
        'swms.invalid_transition',
        'Only an accepted SWMS can be acknowledged.',
        undefined,
        {
          status: row.status,
        },
      );
    await scope.tx
      .insert(acknowledgements)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        swmsId: id,
        revision: row.revision,
        userId: scope.ctx.userId,
        workerName: input.workerName.trim(),
        language: input.language ?? 'en',
        at: now(),
      })
      .onConflictDoNothing();
    return detail(scope, projectId, id);
  }

  /** The checks alone, for the form to show while the SWMS is being written. */
  async function check(scope: TenantScope, projectId: string, id: string) {
    const d = await detail(scope, projectId, id);
    return { gaps: d.gaps, advisories: d.advisories };
  }

  // ---- the module's API for other modules ----

  /** "Stop work: SWMS not followed" (r300): an accepted SWMS goes back for review under a new revision. */
  async function reopenForReview(
    scope: TenantScope,
    projectId: string,
    swmsId: string,
    reason: string,
  ) {
    const [row] = await scope.tx
      .select()
      .from(swms)
      .where(and(eq(swms.id, swmsId), eq(swms.projectId, projectId), isNull(swms.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('swms.not_found');
    if (row.status !== 'accepted') {
      await record(scope, row, { action: 'stop_work_noted', from: row.status, note: reason });
      return;
    }
    const [next] = await scope.tx
      .update(swms)
      .set({
        status: 'submitted',
        revision: row.revision + 1,
        reviewedBy: null,
        reviewedAt: null,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(eq(swms.id, swmsId))
      .returning();
    await record(scope, next!, { action: 'stop_work', from: 'accepted', note: reason });
    await changed(scope, next!);
  }

  async function exists(scope: TenantScope, projectId: string, swmsId: string) {
    const [r] = await scope.tx
      .select({ n: count() })
      .from(swms)
      .where(and(eq(swms.id, swmsId), eq(swms.projectId, projectId), isNull(swms.deletedAt)));
    return (r?.n ?? 0) > 0;
  }

  return { list, create, detail, update, transition, acknowledge, check, reopenForReview, exists };
}

export type SwmsService = ReturnType<typeof createSwmsService>;
