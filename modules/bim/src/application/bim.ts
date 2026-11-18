import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { decodeId, encodeId, parseCaptureLink, uuidv7, type IdKind } from '@archova/domain';
import type {
  AddCoordinationCommentRequest,
  BimModel,
  CoordinationComment,
  CoordinationIssue,
  CoordinationIssueDetail,
  CreateBimModelRequest,
  CreateCoordinationIssueRequest,
  CreateSiteCaptureRequest,
  SiteCapture,
  UpdateSiteCaptureRequest,
  UpdateCoordinationIssueRequest,
} from '@archova/contracts';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import type { RfisApi } from '@archova/mod-rfis';
import { canMove, cleanGuids } from '../domain/issues';
import { issueComments, issues, models, siteCaptures, type IssueStatus } from '../infra/tables';

export interface BimDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  rfis: Pick<RfisApi, 'summariesByIds'>;
  now?: () => Date;
}

type ModelRow = typeof models.$inferSelect;
type IssueRow = typeof issues.$inferSelect;
type CommentRow = typeof issueComments.$inferSelect;
type CaptureRow = typeof siteCaptures.$inferSelect;

const iso = (d: Date) => d.toISOString();
const orNull = (kind: IdKind, id: string | null) => (id ? encodeId(kind, id) : null);
const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);
const ref = (kind: IdKind, value: string, path: string) => {
  const id = decodeId(kind, value);
  if (!id) throw invalid(path, 'Invalid id');
  return id;
};
const escapeLike = (s: string) => s.replace(/[%_\\]/g, (m) => `\\${m}`);

export const modelDto = (m: ModelRow): BimModel => ({
  id: encodeId('bimModel', m.id),
  projectId: encodeId('project', m.projectId),
  name: m.name,
  discipline: m.discipline,
  versionLabel: m.versionLabel,
  fileId: orNull('file', m.fileId),
  status: m.status,
  supersededById: orNull('bimModel', m.supersededById),
  version: m.version,
  createdAt: iso(m.createdAt),
});

export const issueDto = (i: IssueRow, commentCount: number): CoordinationIssue => ({
  id: encodeId('coordinationIssue', i.id),
  projectId: encodeId('project', i.projectId),
  number: i.number,
  title: i.title,
  description: i.description,
  status: i.status,
  priority: i.priority,
  assigneeId: orNull('user', i.assigneeId),
  dueDate: i.dueDate,
  modelId: orNull('bimModel', i.modelId),
  elementGuids: i.elementGuids,
  location: i.location,
  rfiId: orNull('rfi', i.rfiId),
  resolvedAt: i.resolvedAt ? iso(i.resolvedAt) : null,
  commentCount,
  version: i.version,
  createdAt: iso(i.createdAt),
  updatedAt: iso(i.updatedAt),
});

const commentDto = (c: CommentRow): CoordinationComment => ({
  id: encodeId('coordinationComment', c.id),
  authorId: encodeId('user', c.authorId),
  body: c.body,
  createdAt: iso(c.createdAt),
});

export const captureDto = (c: CaptureRow): SiteCapture => ({
  id: encodeId('siteCapture', c.id),
  projectId: encodeId('project', c.projectId),
  title: c.title,
  provider: c.provider,
  url: c.url,
  capturedOn: c.capturedOn,
  area: c.area,
  note: c.note,
  rfiId: orNull('rfi', c.rfiId),
  issueId: orNull('coordinationIssue', c.issueId),
  version: c.version,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

export function createBimService(deps: BimDeps) {
  const now = deps.now ?? (() => new Date());

  async function requireProject(scope: TenantScope, projectId: string) {
    await deps.platform.getProject(scope, projectId);
  }

  async function modelInProject(scope: TenantScope, projectId: string, modelId: string) {
    const [row] = await scope.tx
      .select()
      .from(models)
      .where(and(eq(models.id, modelId), eq(models.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('bim.model_not_found');
    return row;
  }

  async function requireRfi(scope: TenantScope, projectId: string, rfiId: string) {
    const found = await deps.rfis.summariesByIds(scope, projectId, [rfiId]);
    if (found.length === 0) throw invalid('rfiId', 'That RFI is not on this project.');
  }

  // ---- models ------------------------------------------------------------------------------------------

  async function listModels(scope: TenantScope, projectId: string) {
    await requireProject(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(models)
      .where(eq(models.projectId, projectId))
      .orderBy(desc(models.createdAt));
    return { data: rows.map(modelDto) };
  }

  async function createModel(scope: TenantScope, projectId: string, input: CreateBimModelRequest) {
    await requireProject(scope, projectId);
    const name = input.name.trim();
    if (!name) throw invalid('name', 'Give the model a name.');
    if (input.fileId) {
      const f = await deps.files.getFile(scope, ref('file', input.fileId, 'fileId'));
      if (f.projectId !== projectId)
        throw invalid('fileId', 'That file belongs to another project.');
    }
    const old = input.supersedesModelId
      ? await modelInProject(
          scope,
          projectId,
          ref('bimModel', input.supersedesModelId, 'supersedesModelId'),
        )
      : null;
    if (old && old.status !== 'current')
      throw invalid('supersedesModelId', 'That model has already been superseded.');
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(models)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        name,
        discipline: input.discipline,
        versionLabel: input.versionLabel?.trim() ?? '',
        fileId: input.fileId ? ref('file', input.fileId, 'fileId') : null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    if (old)
      await scope.tx
        .update(models)
        .set({
          status: 'superseded',
          supersededById: id,
          updatedBy: scope.ctx.userId,
          updatedAt: now(),
          version: old.version + 1,
        })
        .where(eq(models.id, old.id));
    scope.events.add({
      type: 'bim.model.registered.v1',
      projectId,
      entityType: 'bim_model',
      entityId: id,
      entityVersion: 1,
      data: { modelId: id, supersedes: old?.id ?? null },
    });
    return modelDto(row!);
  }

  // ---- issues ------------------------------------------------------------------------------------------

  async function loadIssue(scope: TenantScope, projectId: string, issueId: string) {
    const [row] = await scope.tx
      .select()
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.projectId, projectId), isNull(issues.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('bim.issue_not_found');
    return row;
  }

  async function detail(
    scope: TenantScope,
    row: IssueRow,
  ): Promise<CoordinationIssueDetail & { version: number }> {
    const comments = await scope.tx
      .select()
      .from(issueComments)
      .where(eq(issueComments.issueId, row.id))
      .orderBy(asc(issueComments.createdAt));
    return {
      issue: issueDto(row, comments.length),
      comments: comments.map(commentDto),
      version: row.version,
    };
  }

  async function listIssues(
    scope: TenantScope,
    projectId: string,
    q: { status?: IssueStatus; modelId?: string; q?: string },
  ) {
    await requireProject(scope, projectId);
    const where: SQL[] = [eq(issues.projectId, projectId), isNull(issues.deletedAt)];
    if (q.status) where.push(eq(issues.status, q.status));
    if (q.modelId) where.push(eq(issues.modelId, ref('bimModel', q.modelId, 'modelId')));
    if (q.q) {
      const text = `%${escapeLike(q.q.trim())}%`;
      const match = or(ilike(issues.title, text), ilike(issues.location, text));
      if (match) where.push(match);
    }
    const rows = await scope.tx
      .select()
      .from(issues)
      .where(and(...where))
      .orderBy(desc(issues.number))
      .limit(500);
    const counts = rows.length
      ? await scope.tx
          .select({ issueId: issueComments.issueId, n: count() })
          .from(issueComments)
          .where(
            inArray(
              issueComments.issueId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(issueComments.issueId)
      : [];
    const byIssue = new Map(counts.map((c) => [c.issueId, Number(c.n)]));
    return { data: rows.map((r) => issueDto(r, byIssue.get(r.id) ?? 0)) };
  }

  async function getIssue(scope: TenantScope, projectId: string, issueId: string) {
    await requireProject(scope, projectId);
    return detail(scope, await loadIssue(scope, projectId, issueId));
  }

  async function createIssue(
    scope: TenantScope,
    projectId: string,
    input: CreateCoordinationIssueRequest,
  ) {
    await requireProject(scope, projectId);
    const title = input.title.trim();
    if (!title) throw invalid('title', 'Give the issue a title.');
    const modelId = input.modelId ? ref('bimModel', input.modelId, 'modelId') : null;
    if (modelId) await modelInProject(scope, projectId, modelId);
    const rfiId = input.rfiId ? ref('rfi', input.rfiId, 'rfiId') : null;
    if (rfiId) await requireRfi(scope, projectId, rfiId);
    const number = await nextNumber(scope, projectId, 'bim:issue');
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(issues)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        title,
        description: input.description?.trim() ?? '',
        priority: input.priority ?? 'medium',
        assigneeId: input.assigneeId ? ref('user', input.assigneeId, 'assigneeId') : null,
        dueDate: input.dueDate ?? null,
        modelId,
        elementGuids: cleanGuids(input.elementGuids ?? []),
        location: input.location?.trim() ?? '',
        rfiId,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'bim.issue.raised.v1',
      projectId,
      entityType: 'coordination_issue',
      entityId: id,
      entityVersion: 1,
      data: { number, actorId: scope.ctx.userId },
    });
    return detail(scope, row!);
  }

  async function updateIssue(
    scope: TenantScope,
    projectId: string,
    issueId: string,
    expectedVersion: number,
    input: UpdateCoordinationIssueRequest,
  ) {
    await requireProject(scope, projectId);
    const row = await loadIssue(scope, projectId, issueId);
    if (row.version !== expectedVersion) throw versionConflict();
    const set: Partial<typeof issues.$inferInsert> = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw invalid('title', 'Give the issue a title.');
      set.title = title;
    }
    if (input.description !== undefined) set.description = input.description.trim();
    if (input.priority !== undefined) set.priority = input.priority;
    if (input.assigneeId !== undefined)
      set.assigneeId = input.assigneeId ? ref('user', input.assigneeId, 'assigneeId') : null;
    if (input.dueDate !== undefined) set.dueDate = input.dueDate;
    if (input.location !== undefined) set.location = input.location.trim();
    if (input.elementGuids !== undefined) set.elementGuids = cleanGuids(input.elementGuids);
    if (input.modelId !== undefined) {
      const modelId = input.modelId ? ref('bimModel', input.modelId, 'modelId') : null;
      if (modelId) await modelInProject(scope, projectId, modelId);
      set.modelId = modelId;
    }
    if (input.rfiId !== undefined) {
      const rfiId = input.rfiId ? ref('rfi', input.rfiId, 'rfiId') : null;
      if (rfiId) await requireRfi(scope, projectId, rfiId);
      set.rfiId = rfiId;
    }
    if (input.status !== undefined && input.status !== row.status) {
      if (!canMove(row.status, input.status))
        throw new AppError(
          'bim.invalid_transition',
          `An issue that is ${row.status.replace('_', ' ')} cannot become ${input.status.replace('_', ' ')}.`,
        );
      set.status = input.status;
      set.resolvedAt = input.status === 'resolved' || input.status === 'closed' ? now() : null;
    }
    const [updated] = await scope.tx
      .update(issues)
      .set({
        ...set,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
        version: row.version + 1,
      })
      .where(and(eq(issues.id, row.id), eq(issues.version, expectedVersion)))
      .returning();
    if (!updated) throw versionConflict();
    if (set.status)
      scope.events.add({
        type: 'bim.issue.status_changed.v1',
        projectId,
        entityType: 'coordination_issue',
        entityId: row.id,
        entityVersion: updated.version,
        data: { from: row.status, to: set.status, actorId: scope.ctx.userId },
      });
    return detail(scope, updated);
  }

  async function addComment(
    scope: TenantScope,
    projectId: string,
    issueId: string,
    input: AddCoordinationCommentRequest,
  ) {
    await requireProject(scope, projectId);
    const row = await loadIssue(scope, projectId, issueId);
    const body = input.body.trim();
    if (!body) throw invalid('body', 'Write a comment.');
    await scope.tx.insert(issueComments).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      issueId: row.id,
      authorId: scope.ctx.userId,
      body,
    });
    return detail(scope, row);
  }

  // ---- site captures (360 tour links; no imagery is stored) -------------------------------------------

  async function loadCapture(scope: TenantScope, projectId: string, captureId: string) {
    const [row] = await scope.tx
      .select()
      .from(siteCaptures)
      .where(
        and(
          eq(siteCaptures.id, captureId),
          eq(siteCaptures.projectId, projectId),
          isNull(siteCaptures.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('bim.capture_not_found');
    return row;
  }

  const linkOrThrow = (raw: string) => {
    const link = parseCaptureLink(raw);
    if (!link)
      throw invalid(
        'url',
        'Paste a share link from Matterport, Kuula or Ricoh Tours (it must start with https://).',
      );
    return link;
  };

  async function listCaptures(scope: TenantScope, projectId: string) {
    await requireProject(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(siteCaptures)
      .where(and(eq(siteCaptures.projectId, projectId), isNull(siteCaptures.deletedAt)))
      .orderBy(desc(siteCaptures.capturedOn), desc(siteCaptures.createdAt))
      .limit(500);
    return { data: rows.map(captureDto) };
  }

  async function createCapture(
    scope: TenantScope,
    projectId: string,
    input: CreateSiteCaptureRequest,
  ) {
    await requireProject(scope, projectId);
    const title = input.title.trim();
    if (!title) throw invalid('title', 'Give the capture a title.');
    const link = linkOrThrow(input.url);
    const rfiId = input.rfiId ? ref('rfi', input.rfiId, 'rfiId') : null;
    if (rfiId) await requireRfi(scope, projectId, rfiId);
    const issueId = input.issueId ? ref('coordinationIssue', input.issueId, 'issueId') : null;
    if (issueId) await loadIssue(scope, projectId, issueId);
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(siteCaptures)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        title,
        provider: link.provider,
        url: link.url,
        capturedOn: input.capturedOn,
        area: input.area?.trim() ?? '',
        note: input.note?.trim() ?? '',
        rfiId,
        issueId,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'bim.capture.added.v1',
      projectId,
      entityType: 'site_capture',
      entityId: id,
      entityVersion: 1,
      data: { provider: link.provider, actorId: scope.ctx.userId },
    });
    return row!;
  }

  async function updateCapture(
    scope: TenantScope,
    projectId: string,
    captureId: string,
    expectedVersion: number,
    input: UpdateSiteCaptureRequest,
  ) {
    await requireProject(scope, projectId);
    const row = await loadCapture(scope, projectId, captureId);
    if (row.version !== expectedVersion) throw versionConflict();
    const set: Partial<typeof siteCaptures.$inferInsert> = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw invalid('title', 'Give the capture a title.');
      set.title = title;
    }
    if (input.url !== undefined) {
      const link = linkOrThrow(input.url);
      set.url = link.url;
      set.provider = link.provider;
    }
    if (input.capturedOn !== undefined) set.capturedOn = input.capturedOn;
    if (input.area !== undefined) set.area = input.area.trim();
    if (input.note !== undefined) set.note = input.note.trim();
    if (input.rfiId !== undefined) {
      const rfiId = input.rfiId ? ref('rfi', input.rfiId, 'rfiId') : null;
      if (rfiId) await requireRfi(scope, projectId, rfiId);
      set.rfiId = rfiId;
    }
    if (input.issueId !== undefined) {
      const issueId = input.issueId ? ref('coordinationIssue', input.issueId, 'issueId') : null;
      if (issueId) await loadIssue(scope, projectId, issueId);
      set.issueId = issueId;
    }
    const [updated] = await scope.tx
      .update(siteCaptures)
      .set({ ...set, updatedBy: scope.ctx.userId, updatedAt: now(), version: row.version + 1 })
      .where(and(eq(siteCaptures.id, row.id), eq(siteCaptures.version, expectedVersion)))
      .returning();
    if (!updated) throw versionConflict();
    return updated;
  }

  async function deleteCapture(scope: TenantScope, projectId: string, captureId: string) {
    await requireProject(scope, projectId);
    const row = await loadCapture(scope, projectId, captureId);
    const [done] = await scope.tx
      .update(siteCaptures)
      .set({
        deletedAt: now(),
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
        version: row.version + 1,
      })
      .where(eq(siteCaptures.id, row.id))
      .returning();
    scope.events.add({
      type: 'bim.capture.removed.v1',
      projectId,
      entityType: 'site_capture',
      entityId: row.id,
      entityVersion: done!.version,
      data: { actorId: scope.ctx.userId },
    });
  }

  return {
    listModels,
    createModel,
    listIssues,
    getIssue,
    createIssue,
    updateIssue,
    addComment,
    listCaptures,
    createCapture,
    updateCapture,
    deleteCapture,
  };
}

export type BimService = ReturnType<typeof createBimService>;
