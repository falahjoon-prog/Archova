import { and, asc, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
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
  failedItems,
  isEditable,
  missingRequired,
  responseProblem,
  type InspectionStatus,
  type ItemResult,
  type ItemSpec,
  type ResponseState,
  type ResponseType,
} from '../domain/inspection';
import type { TradeCategory } from '../domain/dbp';
import { inspections, responses, templateItems, templates } from '../infra/tables';
import { uniqueViolation } from './errors';
import { checkFiles, requireInternal, type QualityDeps } from './shared';

export type TemplateRow = typeof templates.$inferSelect;
export type ItemRow = typeof templateItems.$inferSelect;
export type InspectionRow = typeof inspections.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;

export interface TemplateItemInput {
  section?: string;
  prompt: string;
  responseType: ResponseType;
  options?: string[];
  required?: boolean;
  createsDefectOnFail?: boolean;
}

export interface ResponseInput {
  templateItemId: string;
  value?: unknown;
  result?: ItemResult | null;
  note?: string | null;
  fileIds?: string[];
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
      })),
    );
    return templateDetail(scope, projectId, copy);
  }

  // ---- inspections ----

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
    const specs = items.map(spec);
    return {
      inspection,
      items,
      responses: rows,
      missingRequiredItemIds: missingRequired(specs, byItem).map((i) => i.id),
      failedItemIds: failedItems(specs, byItem).map((i) => i.id),
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

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      /** A device-chosen id, so the record it already shows is the one the next pull confirms. */
      id?: string;
      templateId: string;
      title?: string;
      location?: string;
      scheduledFor?: string;
      inspectorId?: string;
    },
  ) {
    await internal(scope, projectId, 'inspection.not_found');
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
        title: input.title?.trim() || template.name,
        location: input.location ?? null,
        scheduledFor: input.scheduledFor ?? null,
        inspectorId: input.inspectorId ?? scope.ctx.userId,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await changed(scope, row!);
    return detail(scope, projectId, id);
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
      await checkFiles(deps, scope, projectId, r.fileIds ?? [], `responses/${n}/fileIds`);
      const values = {
        value: item.responseType === 'pass_fail_na' ? null : (r.value ?? null),
        result: item.responseType === 'pass_fail_na' ? (r.result ?? null) : null,
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
    input: { signedByName: string; signatureFileId?: string },
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
    if (input.signatureFileId)
      await checkFiles(deps, scope, projectId, [input.signatureFileId], 'signatureFileId');
    const at = now();
    const [row] = await scope.tx
      .update(inspections)
      .set({
        status: 'submitted',
        completedAt: at,
        signedBy: {
          name: input.signedByName.trim(),
          fileId: input.signatureFileId ?? null,
          at: at.toISOString(),
        },
        version: inspection.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(inspections.id, id), eq(inspections.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
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
    return detail(scope, projectId, id);
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

  return {
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
    detail,
    recordResponses,
    submit,
    close,
  };
}

export type InspectionService = ReturnType<typeof createInspectionService>;
