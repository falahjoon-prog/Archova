import { and, asc, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { localDateOf } from '@archova/time';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import {
  failedItems,
  isEditable,
  missingRequiredIn,
  responseProblem,
  sectionSummaries,
  type InspectionStatus,
  type ItemResult,
  type ItemSpec,
  type ResponseState,
  type ResponseType,
} from '../domain/inspection';
import type { TradeCategory } from '../domain/dbp';
import { countActivity, itemSuggestion, type ItemEventKind } from '../domain/item-activity';
import { canSeePrivate, reopenFlag, statusCounts } from '../domain/inspection-record';
import {
  history,
  inspections,
  itemEvents,
  responses,
  signatures,
  templateItems,
  templates,
  type HistoryKind,
} from '../infra/tables';
import { uniqueViolation } from './errors';
import { checkFiles, locationLabel, requireInternal, type QualityDeps } from './shared';

export type TemplateRow = typeof templates.$inferSelect;
export type ItemRow = typeof templateItems.$inferSelect;
export type InspectionRow = typeof inspections.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
export type SignatureRow = typeof signatures.$inferSelect;
export type ItemEventRow = typeof itemEvents.$inferSelect;
export type HistoryRow = typeof history.$inferSelect;

export interface TemplateItemInput {
  section?: string;
  prompt: string;
  responseType: ResponseType;
  options?: string[];
  required?: boolean;
  createsDefectOnFail?: boolean;
  /** Shown behind the item's info icon. */
  helpText?: string;
}

export interface ResponseInput {
  templateItemId: string;
  value?: unknown;
  result?: ItemResult | null;
  note?: string | null;
  fileIds?: string[];
}

export interface HeaderInput {
  title?: string;
  location?: string | null;
  /** A row of the project's location tree; sets `location` to its path. */
  locationId?: string | null;
  /** The inspection date. */
  scheduledFor?: string | null;
  dueDate?: string | null;
  inspectorId?: string;
  assigneeIds?: string[];
  responsibleCompanyId?: string | null;
  pointOfContactId?: string | null;
  trade?: string | null;
  specSection?: string | null;
  description?: string;
  /** Files attached to the inspection itself, as opposed to one item. */
  fileIds?: string[];
  isPrivate?: boolean;
  /** People who are sent the inspection (the Email action's default recipients). */
  distributionIds?: string[];
  /** Drawing revisions the inspection is about. */
  drawingRevisionIds?: string[];
}

const spec = (i: ItemRow): ItemSpec => ({
  id: i.id,
  prompt: i.prompt,
  responseType: i.responseType,
  options: i.options,
  required: i.required,
  createsDefectOnFail: i.createsDefectOnFail,
});

export function createInspectionService(deps: QualityDeps) {
  const now = deps.now ?? (() => new Date());
  const internal = (
    scope: TenantScope,
    projectId: string,
    code: 'inspection.not_found' | 'inspection_template.not_found',
  ) => requireInternal(deps, scope, projectId, code);

  // ---- templates ----

  async function loadTemplate(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(templates)
      .where(
        and(eq(templates.id, id), eq(templates.projectId, projectId), isNull(templates.deletedAt)),
      )
      .limit(1);
    if (!row) throw new AppError('inspection_template.not_found');
    return row;
  }

  const itemsOf = (scope: TenantScope, templateId: string) =>
    scope.tx
      .select()
      .from(templateItems)
      .where(eq(templateItems.templateId, templateId))
      .orderBy(asc(templateItems.sort));

  function checkItems(items: readonly TemplateItemInput[]) {
    items.forEach((it, i) => {
      if (it.responseType === 'select' && (it.options?.length ?? 0) < 2)
        throw new AppError('validation_failed', 'A choice needs at least two options.', [
          { path: `items/${i}/options`, message: 'At least two options' },
        ]);
    });
  }

  async function replaceItems(
    scope: TenantScope,
    templateId: string,
    items: readonly TemplateItemInput[],
  ) {
    await scope.tx.delete(templateItems).where(eq(templateItems.templateId, templateId));
    if (items.length === 0) return;
    await scope.tx.insert(templateItems).values(
      items.map((it, sort) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        templateId,
        section: it.section ?? '',
        sort,
        prompt: it.prompt.trim(),
        responseType: it.responseType,
        options: it.responseType === 'select' ? (it.options ?? []) : [],
        required: it.required ?? true,
        createsDefectOnFail: it.responseType === 'pass_fail_na' && !!it.createsDefectOnFail,
        helpText: it.helpText?.trim() ?? '',
      })),
    );
  }

  async function listTemplates(scope: TenantScope, projectId: string, published?: boolean) {
    await internal(scope, projectId, 'inspection_template.not_found');
    const conditions: SQL[] = [eq(templates.projectId, projectId), isNull(templates.deletedAt)];
    if (published !== undefined) conditions.push(eq(templates.published, published));
    return scope.tx
      .select()
      .from(templates)
      .where(and(...conditions))
      .orderBy(asc(templates.name), desc(templates.version));
  }

  async function templateDetail(scope: TenantScope, projectId: string, id: string) {
    await internal(scope, projectId, 'inspection_template.not_found');
    const template = await loadTemplate(scope, projectId, id);
    return { template, items: await itemsOf(scope, id) };
  }

  async function createTemplate(
    scope: TenantScope,
    projectId: string,
    input: {
      name: string;
      type?: string;
      tradeCategory?: TradeCategory | null;
      items: TemplateItemInput[];
    },
  ) {
    await deps.platform.getProject(scope, projectId);
    checkItems(input.items);
    const id = uuidv7();
    try {
      await scope.tx.insert(templates).values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        name: input.name.trim(),
        type: input.type ?? 'ITP',
        tradeCategory: input.tradeCategory ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
    } catch (e) {
      if (uniqueViolation(e) !== null)
        throw new AppError('conflict', 'A checklist with that name already exists.');
      throw e;
    }
    await replaceItems(scope, id, input.items);
    return templateDetail(scope, projectId, id);
  }

  async function updateTemplate(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: {
      name?: string;
      type?: string;
      tradeCategory?: TradeCategory | null;
      items?: TemplateItemInput[];
    },
  ) {
    const template = await loadTemplate(scope, projectId, id);
    if (template.published)
      throw new AppError(
        'inspection_template.published',
        'A published checklist is frozen. Start a new version to change it.',
      );
    if (input.items) checkItems(input.items);
    try {
      await scope.tx
        .update(templates)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.tradeCategory !== undefined ? { tradeCategory: input.tradeCategory } : {}),
          updatedAt: now(),
          updatedBy: scope.ctx.userId,
        })
        .where(eq(templates.id, id));
    } catch (e) {
      if (uniqueViolation(e) !== null)
        throw new AppError('conflict', 'A checklist with that name already exists.');
      throw e;
    }
    if (input.items) await replaceItems(scope, id, input.items);
    return templateDetail(scope, projectId, id);
  }

  async function publishTemplate(scope: TenantScope, projectId: string, id: string) {
    const template = await loadTemplate(scope, projectId, id);
    if (template.published)
      throw new AppError('inspection_template.published', 'This checklist is already published.');
    const items = await itemsOf(scope, id);
    if (items.length === 0)
      throw new AppError('validation_failed', 'Add at least one item before publishing.', [
        { path: 'items', message: 'At least one item' },
      ]);
    await scope.tx
      .update(templates)
      .set({ published: true, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(templates.id, id));
    // A published checklist is frozen, so its version number is all a device needs to tell copies apart.
    await scope.recordChange({
      module: 'quality',
      entityType: 'inspection_template',
      entityId: id,
      op: 'upsert',
      version: template.version,
      projectId,
      isPrivate: false,
    });
    return templateDetail(scope, projectId, id);
  }

  async function newTemplateVersion(scope: TenantScope, projectId: string, id: string) {
    const template = await loadTemplate(scope, projectId, id);
    if (!template.published)
      throw new AppError(
        'inspection_template.not_published',
        'Edit this draft directly; versions start from a published checklist.',
      );
    const [latest] = await scope.tx
      .select({ version: templates.version })
      .from(templates)
      .where(
        and(
          eq(templates.projectId, projectId),
          eq(templates.name, template.name),
          isNull(templates.deletedAt),
        ),
      )
      .orderBy(desc(templates.version))
      .limit(1);
    const copy = uuidv7();
    await scope.tx.insert(templates).values({
      id: copy,
      orgId: scope.ctx.orgId,
      projectId,
      name: template.name,
      type: template.type,
      tradeCategory: template.tradeCategory,
      version: (latest?.version ?? template.version) + 1,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    await replaceItems(
      scope,
      copy,
      (await itemsOf(scope, id)).map((i) => ({
        section: i.section,
        prompt: i.prompt,
        responseType: i.responseType,
        options: i.options,
        required: i.required,
        createsDefectOnFail: i.createsDefectOnFail,
        helpText: i.helpText,
      })),
    );
    return templateDetail(scope, projectId, copy);
  }

  // ---- inspections ----

  /** Who may open a private inspection: the people on it, and anyone who can close inspections. */
  async function privacy(scope: TenantScope, projectId: string) {
    const canClose = await deps.access.can(scope, 'quality.inspections.close', { projectId });
    const uid = scope.ctx.userId;
    return {
      canClose,
      /** A SQL condition that hides private inspections from everyone else, or null when nothing is hidden. */
      where: canClose
        ? null
        : or(
            eq(inspections.isPrivate, false),
            eq(inspections.createdBy, uid),
            eq(inspections.inspectorId, uid),
            sql`${uid}::uuid = any(${inspections.assigneeIds})`,
          )!,
    };
  }

  /** One line in the inspection's change history. */
  async function record(
    scope: TenantScope,
    inspection: { id: string; projectId: string },
    kind: HistoryKind,
    detail: Record<string, unknown> = {},
  ) {
    await scope.tx.insert(history).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: inspection.projectId,
      inspectionId: inspection.id,
      kind,
      detail,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function load(scope: TenantScope, projectId: string, id: string) {
    await internal(scope, projectId, 'inspection.not_found');
    const [row] = await scope.tx
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.id, id),
          eq(inspections.projectId, projectId),
          isNull(inspections.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('inspection.not_found');
    if (row.isPrivate) {
      const p = await privacy(scope, projectId);
      if (!canSeePrivate(row, scope.ctx.userId, p.canClose))
        throw new AppError('inspection.not_found');
    }
    return row;
  }

  async function changed(scope: TenantScope, r: InspectionRow) {
    await scope.recordChange({
      module: 'quality',
      entityType: 'inspection',
      entityId: r.id,
      op: 'upsert',
      version: r.version,
      projectId: r.projectId,
      isPrivate: false,
    });
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const inspection = await load(scope, projectId, id);
    const items = await itemsOf(scope, inspection.templateId);
    const rows = await scope.tx.select().from(responses).where(eq(responses.inspectionId, id));
    const byItem = new Map<string, ResponseState>(
      rows.map((r) => [r.templateItemId, { value: r.value, result: r.result, fileIds: r.fileIds }]),
    );
    const sigs = await scope.tx
      .select()
      .from(signatures)
      .where(eq(signatures.inspectionId, id))
      .orderBy(asc(signatures.at), asc(signatures.id));
    const naSections = new Set(inspection.naSections);
    const specs = items.map((i) => ({ ...spec(i), section: i.section }));
    const events = await scope.tx.select().from(itemEvents).where(eq(itemEvents.inspectionId, id));
    const byItemEvents = new Map<string, ItemEventRow[]>();
    for (const e of events)
      byItemEvents.set(e.templateItemId, [...(byItemEvents.get(e.templateItemId) ?? []), e]);
    const itemActivity = items.map((i) => {
      const own = byItemEvents.get(i.id) ?? [];
      const counts = countActivity(own.map((e) => ({ kind: e.kind, fileCount: e.fileIds.length })));
      const answer = rows.find((r) => r.templateItemId === i.id);
      return {
        templateItemId: i.id,
        ...counts,
        suggestion: itemSuggestion(answer?.result ?? null, counts.photos, counts.observations),
      };
    });
    return {
      inspection,
      items,
      itemActivity,
      signatures: sigs,
      responses: rows,
      sections: sectionSummaries(specs, byItem, naSections),
      summary: statusCounts(sectionSummaries(specs, byItem, naSections)),
      reopenFlag: reopenFlag(inspection.reopenCount),
      missingRequiredItemIds: missingRequiredIn(specs, byItem, naSections).map((i) => i.id),
      failedItemIds: failedItems(
        specs.filter((i) => !naSections.has(i.section)),
        byItem,
      ).map((i) => i.id),
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: InspectionStatus; templateId?: string; limit: number; cursor?: string },
  ) {
    await internal(scope, projectId, 'inspection.not_found');
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(inspections.projectId, projectId), isNull(inspections.deletedAt)];
    const hide = (await privacy(scope, projectId)).where;
    if (hide) conditions.push(hide);
    if (opts.status) conditions.push(eq(inspections.status, opts.status));
    if (opts.templateId) conditions.push(eq(inspections.templateId, opts.templateId));
    if (after) conditions.push(lt(inspections.id, after.id));
    const rows = await scope.tx
      .select()
      .from(inspections)
      .where(and(...conditions))
      .orderBy(desc(inspections.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  /** People and the company on the header must belong to this project. */
  async function checkHeader(scope: TenantScope, projectId: string, input: HeaderInput) {
    for (const [path, v] of [
      ['scheduledFor', input.scheduledFor],
      ['dueDate', input.dueDate],
    ] as const)
      if (v && !ISO_DATE.test(v.slice(0, 10)))
        throw new AppError('validation_failed', 'Use a calendar date.', [
          { path, message: 'Not a date' },
        ]);
    const people: (readonly [string, string])[] = [
      ...(input.assigneeIds ?? []).map((u, i) => [`assigneeIds/${i}`, u] as const),
      ...(input.pointOfContactId ? [['pointOfContactId', input.pointOfContactId] as const] : []),
      ...(input.inspectorId ? [['inspectorId', input.inspectorId] as const] : []),
    ];
    people.push(
      ...(input.distributionIds ?? []).map((u, i) => [`distributionIds/${i}`, u] as const),
    );
    for (const [path, userId] of people) {
      const m = await deps.platform.getProjectMembership(scope, projectId, userId);
      if (!m)
        throw new AppError('validation_failed', 'Choose people who are on this project.', [
          { path, message: 'Not a member of the project' },
        ]);
    }
    if (input.responsibleCompanyId) {
      const onProject = await deps.platform.projectCompanies(scope, projectId);
      if (!onProject.some((c) => c.id === input.responsibleCompanyId))
        throw new AppError('validation_failed', 'Choose a company on this project.', [
          { path: 'responsibleCompanyId', message: 'Not a company on the project' },
        ]);
    }
    if (input.locationId)
      input.location = await locationLabel(deps, scope, projectId, input.locationId);
    if (input.fileIds?.length) await checkFiles(deps, scope, projectId, input.fileIds);
    for (const [i, revisionId] of (input.drawingRevisionIds ?? []).entries()) {
      const rev = await deps.documents.getDrawingRevision(scope, projectId, revisionId);
      if (rev.status === 'draft')
        throw new AppError('validation_failed', 'Link a published drawing.', [
          { path: `drawingRevisionIds/${i}`, message: 'Not a published drawing revision' },
        ]);
    }
  }

  /** Only the fields that were sent, mapped to columns. */
  function headerValues(input: HeaderInput) {
    const v: Record<string, unknown> = {};
    if (input.location !== undefined) v.location = input.location;
    if (input.locationId !== undefined) v.locationId = input.locationId;
    if (input.scheduledFor !== undefined) v.scheduledFor = input.scheduledFor;
    if (input.dueDate !== undefined) v.dueDate = input.dueDate;
    if (input.assigneeIds !== undefined) v.assigneeIds = input.assigneeIds;
    if (input.responsibleCompanyId !== undefined)
      v.responsibleCompanyId = input.responsibleCompanyId;
    if (input.pointOfContactId !== undefined) v.pointOfContactId = input.pointOfContactId;
    if (input.trade !== undefined) v.trade = input.trade;
    if (input.specSection !== undefined) v.specSection = input.specSection;
    if (input.description !== undefined) v.description = input.description;
    if (input.fileIds !== undefined) v.fileIds = input.fileIds;
    if (input.isPrivate !== undefined) v.isPrivate = input.isPrivate;
    if (input.distributionIds !== undefined) v.distributionIds = input.distributionIds;
    if (input.drawingRevisionIds !== undefined) v.drawingRevisionIds = input.drawingRevisionIds;
    return v;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: HeaderInput,
  ) {
    const inspection = await load(scope, projectId, id);
    if (!isEditable(inspection.status))
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} can't be edited.`,
        undefined,
        { status: inspection.status },
      );
    if (inspection.version !== expectedVersion) throw versionConflict();
    await checkHeader(scope, projectId, input);
    const at = now();
    const [row] = await scope.tx
      .update(inspections)
      .set({
        ...headerValues(input),
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.inspectorId ? { inspectorId: input.inspectorId } : {}),
        version: inspection.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    await record(scope, row, 'updated', {
      fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined),
    });
    return detail(scope, projectId, id);
  }

  /** Mark a whole section not applicable (or put it back). */
  async function setSectionNa(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    section: string,
    na: boolean,
  ) {
    const inspection = await load(scope, projectId, id);
    if (!isEditable(inspection.status))
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} can't be edited.`,
        undefined,
        { status: inspection.status },
      );
    if (inspection.version !== expectedVersion) throw versionConflict();
    const items = await itemsOf(scope, inspection.templateId);
    if (!items.some((i) => (i.section ?? '') === section))
      throw new AppError('validation_failed', 'That section is not on this checklist.', [
        { path: 'section', message: 'Unknown section' },
      ]);
    const current = inspection.naSections ?? [];
    const next = na ? [...new Set([...current, section])] : current.filter((s) => s !== section);
    const [row] = await scope.tx
      .update(inspections)
      .set({
        naSections: next,
        version: inspection.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    await record(scope, row, 'section_na', { section, na });
    return detail(scope, projectId, id);
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: HeaderInput & {
      /** A device-chosen id, so the record it already shows is the one the next pull confirms. */
      id?: string;
      templateId: string;
    },
  ) {
    await internal(scope, projectId, 'inspection.not_found');
    await checkHeader(scope, projectId, input);
    const template = await loadTemplate(scope, projectId, input.templateId);
    if (!template.published)
      throw new AppError(
        'inspection_template.not_published',
        'Publish the checklist before inspecting with it.',
      );
    const id = input.id ?? uuidv7();
    if (input.id) {
      // A retry after a lost response: the inspection is already there, so answer with it.
      const [existing] = await scope.tx
        .select({ id: inspections.id })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.projectId, projectId)))
        .limit(1);
      if (existing) return detail(scope, projectId, id);
    }
    const number = await nextNumber(scope, projectId, 'inspection');
    const [row] = await scope.tx
      .insert(inspections)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        templateId: template.id,
        templateVersion: template.version,
        number,
        ...headerValues(input),
        title: input.title?.trim() || template.name,
        inspectorId: input.inspectorId ?? scope.ctx.userId,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await changed(scope, row!);
    await record(scope, row!, 'created', { template: template.name });
    return detail(scope, projectId, id);
  }

  async function logItemEvent(
    scope: TenantScope,
    inspection: InspectionRow,
    templateItemId: string,
    kind: ItemEventKind,
    e: {
      body?: string | null;
      result?: ItemResult | null;
      fileIds?: string[];
      observationId?: string;
    },
  ) {
    await scope.tx.insert(itemEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: inspection.projectId,
      inspectionId: inspection.id,
      templateItemId,
      kind,
      body: e.body ?? null,
      result: e.result ?? null,
      fileIds: e.fileIds ?? [],
      observationId: e.observationId ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  /** Photos and other files are logged separately so the strip can count them apart. */
  async function logFiles(
    scope: TenantScope,
    inspection: InspectionRow,
    templateItemId: string,
    files: { id: string; isImage: boolean }[],
    alreadyThere: ReadonlySet<string>,
  ) {
    const fresh = files.filter((f) => !alreadyThere.has(f.id));
    const photos = fresh.filter((f) => f.isImage).map((f) => f.id);
    const others = fresh.filter((f) => !f.isImage).map((f) => f.id);
    if (photos.length)
      await logItemEvent(scope, inspection, templateItemId, 'photo', { fileIds: photos });
    if (others.length)
      await logItemEvent(scope, inspection, templateItemId, 'attachment', { fileIds: others });
  }

  async function itemOf(scope: TenantScope, inspection: InspectionRow, templateItemId: string) {
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
    return item;
  }

  /** The item's activity, oldest first. */
  async function itemActivityLog(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
    templateItemId: string,
  ) {
    const inspection = await load(scope, projectId, inspectionId);
    await itemOf(scope, inspection, templateItemId);
    return scope.tx
      .select()
      .from(itemEvents)
      .where(
        and(
          eq(itemEvents.inspectionId, inspectionId),
          eq(itemEvents.templateItemId, templateItemId),
        ),
      )
      .orderBy(asc(itemEvents.at), asc(itemEvents.id));
  }

  /** The "Add Comment" box and "Attach Files" on one item, without touching the answer. */
  async function addItemComment(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
    templateItemId: string,
    input: { body?: string; fileIds?: string[] },
  ) {
    const inspection = await load(scope, projectId, inspectionId);
    if (!isEditable(inspection.status))
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} can't be changed.`,
        undefined,
        { status: inspection.status },
      );
    await itemOf(scope, inspection, templateItemId);
    const body = input.body?.trim() ?? '';
    const fileIds = [...new Set(input.fileIds ?? [])];
    if (!body && fileIds.length === 0)
      throw new AppError('validation_failed', 'Add a comment or attach a file.', [
        { path: 'body', message: 'A comment or a file is required' },
      ]);
    const checked = await checkFiles(deps, scope, projectId, fileIds);
    if (body) await logItemEvent(scope, inspection, templateItemId, 'comment', { body });
    await logFiles(scope, inspection, templateItemId, checked, new Set());
    return detail(scope, projectId, inspectionId);
  }

  async function recordResponses(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: ResponseInput[],
  ) {
    const inspection = await load(scope, projectId, id);
    if (!isEditable(inspection.status))
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} can't be changed.`,
        undefined,
        { status: inspection.status },
      );
    const items = new Map((await itemsOf(scope, inspection.templateId)).map((i) => [i.id, i]));
    const at = now();
    const previous = new Map(
      (await scope.tx.select().from(responses).where(eq(responses.inspectionId, id))).map((r) => [
        r.templateItemId,
        r,
      ]),
    );
    for (const [n, r] of input.entries()) {
      const item = items.get(r.templateItemId);
      if (!item)
        throw new AppError('inspection.invalid_response', 'That item is not on this checklist.', [
          { path: `responses/${n}/templateItemId`, message: 'Not on this checklist' },
        ]);
      const problem = responseProblem(spec(item), r);
      if (problem)
        throw new AppError('inspection.invalid_response', problem, [
          { path: `responses/${n}`, message: problem },
        ]);
      const checked = await checkFiles(
        deps,
        scope,
        projectId,
        r.fileIds ?? [],
        `responses/${n}/fileIds`,
      );
      const values = {
        // N/A overrides any item type; otherwise only pass/fail items carry a result.
        value: item.responseType === 'pass_fail_na' || r.result === 'na' ? null : (r.value ?? null),
        result:
          r.result === 'na' || item.responseType === 'pass_fail_na' ? (r.result ?? null) : null,
        note: r.note ?? null,
        fileIds: [...new Set(r.fileIds ?? [])],
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      };
      await scope.tx
        .insert(responses)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          inspectionId: id,
          templateItemId: r.templateItemId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [responses.inspectionId, responses.templateItemId],
          set: values,
        });
      const before = previous.get(r.templateItemId);
      const sameAnswer =
        before !== undefined &&
        before.result === values.result &&
        JSON.stringify(before.value ?? null) === JSON.stringify(values.value ?? null);
      if (!sameAnswer)
        await logItemEvent(scope, inspection, r.templateItemId, 'response', {
          result: values.result,
          body: values.result === null && values.value !== null ? String(values.value) : null,
        });
      if (values.note && values.note !== (before?.note ?? null))
        await logItemEvent(scope, inspection, r.templateItemId, 'comment', { body: values.note });
      await logFiles(scope, inspection, r.templateItemId, checked, new Set(before?.fileIds ?? []));
    }
    const [row] = await scope.tx
      .update(inspections)
      .set({
        status: 'in_progress',
        version: inspection.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(eq(inspections.id, id))
      .returning();
    await changed(scope, row!);
    return detail(scope, projectId, id);
  }

  async function submit(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { signedByName?: string; signatureFileId?: string },
  ) {
    const d = await detail(scope, projectId, id);
    const { inspection } = d;
    if (!isEditable(inspection.status))
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} can't be submitted.`,
        undefined,
        { status: inspection.status },
      );
    if (inspection.version !== expectedVersion) throw versionConflict();
    if (d.missingRequiredItemIds.length > 0)
      throw new AppError(
        'inspection.incomplete',
        'Answer every required item before submitting.',
        d.missingRequiredItemIds.map((itemId) => ({
          path: `items/${itemId}`,
          message: 'Required',
        })),
      );
    if (!input.signedByName && d.signatures.length === 0)
      throw new AppError('inspection.incomplete', 'Add a signature before submitting.', [
        { path: 'signedByName', message: 'A signature is required' },
      ]);
    if (input.signatureFileId)
      await checkFiles(deps, scope, projectId, [input.signatureFileId], 'signatureFileId');
    const at = now();
    if (input.signedByName)
      await scope.tx.insert(signatures).values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        inspectionId: id,
        name: input.signedByName.trim(),
        fileId: input.signatureFileId ?? null,
        signedBy: scope.ctx.userId,
        at,
      });
    const first = input.signedByName
      ? {
          name: input.signedByName.trim(),
          fileId: input.signatureFileId ?? null,
          at: at.toISOString(),
        }
      : (() => {
          const g = d.signatures[0]!;
          return { name: g.name, fileId: g.fileId, at: g.at.toISOString() };
        })();
    const [row] = await scope.tx
      .update(inspections)
      .set({
        status: 'submitted',
        completedAt: at,
        signedBy: first,
        version: inspection.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    await record(scope, row, 'submitted', { failedItems: d.failedItemIds.length });
    scope.events.add({
      type: 'quality.inspection.submitted.v1',
      projectId,
      entityType: 'inspection',
      entityId: id,
      entityVersion: row.version,
      data: { inspectionId: id, failedItems: d.failedItemIds.length },
    });
    return detail(scope, projectId, id);
  }

  /** An extra signature (contractor, client) while the inspection is open or submitted. */
  async function addSignature(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { name: string; fileId?: string },
  ) {
    const inspection = await load(scope, projectId, id);
    if (inspection.status === 'closed')
      throw new AppError(
        'inspection.invalid_state',
        "A closed inspection can't be signed.",
        undefined,
        {
          status: inspection.status,
        },
      );
    if (input.fileId) await checkFiles(deps, scope, projectId, [input.fileId], 'fileId');
    await scope.tx.insert(signatures).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      inspectionId: id,
      name: input.name.trim(),
      fileId: input.fileId ?? null,
      signedBy: scope.ctx.userId,
      at: now(),
    });
    await record(scope, inspection, 'signed', { name: input.name.trim() });
    return detail(scope, projectId, id);
  }

  async function close(scope: TenantScope, projectId: string, id: string, expectedVersion: number) {
    const inspection = await load(scope, projectId, id);
    if (inspection.status !== 'submitted')
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} can't be closed.`,
        undefined,
        { status: inspection.status },
      );
    if (inspection.version !== expectedVersion) throw versionConflict();
    const [row] = await scope.tx
      .update(inspections)
      .set({
        status: 'closed',
        version: inspection.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    await record(scope, row, 'closed');
    return detail(scope, projectId, id);
  }

  /**
   * Put a submitted or closed inspection back in progress. A reason is required and it is counted: reopened
   * twice or more is flagged on the record. Reopening a closed one takes the close permission.
   */
  async function reopen(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    reason: string,
  ) {
    const inspection = await load(scope, projectId, id);
    if (inspection.status !== 'submitted' && inspection.status !== 'closed')
      throw new AppError(
        'inspection.invalid_state',
        `An inspection that is ${inspection.status} is already open.`,
        undefined,
        { status: inspection.status },
      );
    if (
      inspection.status === 'closed' &&
      !(await deps.access.can(scope, 'quality.inspections.close', { projectId }))
    )
      throw new AppError(
        'access.denied',
        'Only someone who can close inspections can reopen a closed one.',
      );
    if (inspection.version !== expectedVersion) throw versionConflict();
    if (!reason.trim())
      throw new AppError('validation_failed', 'Say why it is being reopened.', [
        { path: 'reason', message: 'Required' },
      ]);
    const [row] = await scope.tx
      .update(inspections)
      .set({
        status: 'in_progress',
        completedAt: null,
        reopenCount: inspection.reopenCount + 1,
        version: inspection.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    await record(scope, row, 'reopened', {
      reason: reason.trim(),
      from: inspection.status,
      count: row.reopenCount,
    });
    scope.events.add({
      type: 'quality.inspection.reopened.v1',
      projectId,
      entityType: 'inspection',
      entityId: id,
      entityVersion: row.version,
      data: { inspectionId: id, reopenCount: row.reopenCount },
    });
    return detail(scope, projectId, id);
  }

  /** Delete an inspection (admins). It disappears from lists; the history keeps a record that it was deleted. */
  async function remove(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
  ) {
    const inspection = await load(scope, projectId, id);
    if (inspection.version !== expectedVersion) throw versionConflict();
    const at = now();
    const [row] = await scope.tx
      .update(inspections)
      .set({
        deletedAt: at,
        version: inspection.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await scope.recordChange({
      module: 'quality',
      entityType: 'inspection',
      entityId: id,
      op: 'delete',
      version: row.version,
      projectId,
      isPrivate: false,
    });
    await record(scope, row, 'deleted');
  }

  /** The inspection's change history, oldest first. */
  async function changeHistory(scope: TenantScope, projectId: string, id: string) {
    await load(scope, projectId, id);
    return scope.tx
      .select()
      .from(history)
      .where(eq(history.inspectionId, id))
      .orderBy(asc(history.at), asc(history.id));
  }

  /** The project an inspection belongs to (RLS limits this to the caller's organisation), or null. */
  async function projectOf(scope: TenantScope, id: string) {
    const [row] = await scope.tx
      .select({ projectId: inspections.projectId })
      .from(inspections)
      .where(and(eq(inspections.id, id), isNull(inspections.deletedAt)))
      .limit(1);
    return row?.projectId ?? null;
  }

  /** Inspections among `ids` the caller may see (builder staff only), each with its checklist, for the mobile pull. */
  async function visibleAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    await internal(scope, projectId, 'inspection.not_found').catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'inspection.not_found') return null;
      throw e;
    });
    const out: Awaited<ReturnType<typeof detail>>[] = [];
    for (const id of ids) {
      try {
        out.push(await detail(scope, projectId, id));
      } catch (e) {
        if (!(e instanceof AppError && e.code === 'inspection.not_found')) throw e;
      }
    }
    return out;
  }

  /** The project a template belongs to, for a queued command that carries only the template's id. */
  async function templateProjectOf(scope: TenantScope, templateId: string) {
    const [row] = await scope.tx
      .select({ projectId: templates.projectId })
      .from(templates)
      .where(and(eq(templates.id, templateId), isNull(templates.deletedAt)))
      .limit(1);
    return row?.projectId ?? null;
  }

  /** Published checklists among `ids` with their items, for the mobile pull (a draft is not for inspecting). */
  async function templatesAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    await internal(scope, projectId, 'inspection_template.not_found').catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'inspection_template.not_found') return null;
      throw e;
    });
    const out: Awaited<ReturnType<typeof templateDetail>>[] = [];
    for (const id of ids) {
      try {
        const d = await templateDetail(scope, projectId, id);
        if (d.template.published) out.push(d);
      } catch (e) {
        if (!(e instanceof AppError && e.code === 'inspection_template.not_found')) throw e;
      }
    }
    return out;
  }

  /**
   * Portfolio dashboard (`reporting`): inspections not yet closed, those past their due date and those due in the next
   * 7 days. Inspections are the builder's, so anyone else reads `restricted`; private ones are hidden as on the list.
   */
  async function portfolioCounts(scope: TenantScope, projectId: string) {
    const allowed =
      scope.ctx.principalType === 'member' &&
      (await deps.access.can(scope, 'quality.inspections.read', { projectId }));
    if (!allowed) return { restricted: true, open: 0, overdue: 0, dueSoon: 0 };
    const project = await deps.platform.getProject(scope, projectId);
    const date = localDateOf(now(), project.timezone);
    const conditions: SQL[] = [
      eq(inspections.projectId, projectId),
      isNull(inspections.deletedAt),
      sql`${inspections.status} <> 'closed'`,
    ];
    const hide = (await privacy(scope, projectId)).where;
    if (hide) conditions.push(hide);
    const [row] = await scope.tx
      .select({
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`(count(*) filter (where ${inspections.dueDate} < ${date}::date))::int`,
        dueSoon: sql<number>`(count(*) filter (where ${inspections.dueDate} >= ${date}::date and ${inspections.dueDate} <= ${date}::date + 7))::int`,
      })
      .from(inspections)
      .where(and(...conditions));
    return {
      restricted: false,
      open: row?.open ?? 0,
      overdue: row?.overdue ?? 0,
      dueSoon: row?.dueSoon ?? 0,
    };
  }

  return {
    portfolioCounts,
    projectOf,
    templateProjectOf,
    templatesAmong,
    visibleAmong,
    listTemplates,
    templateDetail,
    createTemplate,
    updateTemplate,
    publishTemplate,
    newTemplateVersion,
    list,
    create,
    update,
    setSectionNa,
    detail,
    itemActivityLog,
    addItemComment,
    recordResponses,
    submit,
    addSignature,
    close,
    reopen,
    remove,
    changeHistory,
  };
}

export type InspectionService = ReturnType<typeof createInspectionService>;
