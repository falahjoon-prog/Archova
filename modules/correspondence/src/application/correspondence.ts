import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { atLeast } from '@archova/domain/permissions';
import { localDateOf } from '@archova/time';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
  type SearchHit,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  auDate,
  canClose,
  canEditItem,
  canRespond,
  canRespondAs,
  canSeeItem,
  canSend,
  canWriteDraft,
  canVoid,
  checkFieldDefinitions,
  checkFieldValues,
  dueDateFor,
  renderTemplate,
  sentInTime,
  timeBarDate,
  timeBarState,
  type CorrespondenceStatus,
  type CorrespondenceViewer,
  type FieldDefinition,
  type HistoryChange,
  type RelatedLink,
} from '../domain/correspondence';
import { TYPE_TEMPLATES, findTemplate } from '../domain/templates';
import { itemAccess, itemHistory, items, responses, types } from '../infra/tables';

export type TypeRow = typeof types.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
export type HistoryRow = typeof itemHistory.$inferSelect;
export type ItemView = ItemRow & {
  timeBarState: ReturnType<typeof timeBarState>;
  sentInTime: boolean | null;
};

export interface CorrespondenceDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'getProjectMembership' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface TypeFields {
  name?: string;
  prefix?: string;
  description?: string;
  isEvidential?: boolean;
  responseRequired?: boolean;
  responseDays?: number;
  timeBarDays?: number | null;
  subjectTemplate?: string;
  bodyTemplate?: string;
  fields?: FieldDefinition[];
}

export interface ItemFields {
  typeId?: string;
  subject?: string;
  body?: string;
  fromCompanyId?: string | null;
  toCompanyIds?: string[];
  responseRequired?: boolean;
  dueDate?: string | null;
  eventDate?: string | null;
  timeBarDays?: number | null;
  fileIds?: string[];
  related?: RelatedLink[];
  isPrivate?: boolean;
  /** Values for the type's fields; null clears one. */
  fieldValues?: Record<string, unknown>;
}

export function createCorrespondenceService(deps: CorrespondenceDeps) {
  const now = deps.now ?? (() => new Date());

  // ---- types (org level) -------------------------------------------------------------------------------

  const templates = () => TYPE_TEMPLATES;

  async function listTypes(scope: TenantScope, opts: { includeArchived: boolean }) {
    return scope.tx
      .select()
      .from(types)
      .where(opts.includeArchived ? undefined : isNull(types.archivedAt))
      .orderBy(asc(types.name));
  }

  async function getType(scope: TenantScope, id: string) {
    const [row] = await scope.tx.select().from(types).where(eq(types.id, id)).limit(1);
    if (!row) throw new AppError('correspondence_type.not_found');
    return row;
  }

  async function checkPrefix(scope: TenantScope, prefix: string, exceptId?: string) {
    const [dup] = await scope.tx
      .select({ id: types.id })
      .from(types)
      .where(and(eq(types.prefix, prefix), isNull(types.archivedAt)))
      .limit(1);
    if (dup && dup.id !== exceptId)
      throw new AppError('correspondence_type.prefix_taken', 'That prefix is already in use.', [
        { path: 'prefix', message: 'Already used by another type' },
      ]);
  }

  function checkFields(defs: FieldDefinition[]) {
    const problems = checkFieldDefinitions(defs);
    if (problems.length)
      throw new AppError('validation_failed', 'These fields are not valid.', problems);
  }

  async function createType(
    scope: TenantScope,
    input: TypeFields & { templateKey?: string },
  ): Promise<TypeRow> {
    const tpl = input.templateKey ? findTemplate(input.templateKey) : undefined;
    if (input.templateKey && !tpl)
      throw new AppError('validation_failed', 'Unknown template', [
        { path: 'templateKey', message: 'Unknown template' },
      ]);
    const name = (input.name ?? tpl?.name)?.trim();
    const prefix = (input.prefix ?? tpl?.prefix)?.trim().toUpperCase();
    if (!name || !prefix)
      throw new AppError('validation_failed', 'A name and a prefix are required.', [
        { path: name ? 'prefix' : 'name', message: 'Required' },
      ]);
    await checkPrefix(scope, prefix);
    if (input.fields) checkFields(input.fields);
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(types)
      .values({
        id,
        orgId: scope.ctx.orgId,
        name,
        prefix,
        description: input.description ?? tpl?.description ?? '',
        templateKey: tpl?.key ?? null,
        isEvidential: input.isEvidential ?? tpl?.isEvidential ?? false,
        responseRequired: input.responseRequired ?? tpl?.responseRequired ?? false,
        responseDays: input.responseDays ?? tpl?.responseDays ?? 10,
        timeBarDays:
          input.timeBarDays !== undefined ? input.timeBarDays : (tpl?.timeBarDays ?? null),
        subjectTemplate: input.subjectTemplate ?? tpl?.subjectTemplate ?? '',
        bodyTemplate: input.bodyTemplate ?? tpl?.bodyTemplate ?? '',
        fields: input.fields ?? [],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'correspondence.type.created.v1',
      entityType: 'correspondence_type',
      entityId: id,
      entityVersion: 1,
      data: { typeId: id, prefix, templateKey: row!.templateKey },
    });
    return row!;
  }

  async function updateType(
    scope: TenantScope,
    id: string,
    expectedVersion: number,
    patch: TypeFields & { archived?: boolean },
  ): Promise<TypeRow> {
    const current = await getType(scope, id);
    if (current.version !== expectedVersion) throw versionConflict();
    const prefix = patch.prefix?.trim().toUpperCase();
    if (prefix && prefix !== current.prefix) await checkPrefix(scope, prefix, id);
    if (patch.archived === false && current.archivedAt)
      await checkPrefix(scope, prefix ?? current.prefix, id);
    const set: Partial<typeof types.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (prefix) set.prefix = prefix;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.isEvidential !== undefined) set.isEvidential = patch.isEvidential;
    if (patch.responseRequired !== undefined) set.responseRequired = patch.responseRequired;
    if (patch.responseDays !== undefined) set.responseDays = patch.responseDays;
    if (patch.timeBarDays !== undefined) set.timeBarDays = patch.timeBarDays;
    if (patch.subjectTemplate !== undefined) set.subjectTemplate = patch.subjectTemplate;
    if (patch.bodyTemplate !== undefined) set.bodyTemplate = patch.bodyTemplate;
    if (patch.fields !== undefined) {
      checkFields(patch.fields);
      set.fields = patch.fields;
    }
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? now() : null;
    const [row] = await scope.tx
      .update(types)
      .set({ ...set, version: current.version + 1, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(and(eq(types.id, id), eq(types.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'correspondence.type.updated.v1',
      entityType: 'correspondence_type',
      entityId: id,
      entityVersion: row.version,
      data: { typeId: id, changed: Object.keys(patch) },
    });
    return row;
  }

  // ---- items (project level) ---------------------------------------------------------------------------

  const clip = (v: unknown) =>
    typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;

  /** Appends to the item's change history: who did what, and for an edit what each field was and became. */
  async function record(
    scope: TenantScope,
    itemId: string,
    action: string,
    changes: HistoryChange[] = [],
  ) {
    await scope.tx.insert(itemHistory).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      itemId,
      at: now(),
      byUser: scope.ctx.userId,
      action,
      changes: changes.map((c) => ({ field: c.field, from: clip(c.from), to: clip(c.to) })),
    });
  }

  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  async function isListed(scope: TenantScope, itemId: string, userId: string) {
    const [r] = await scope.tx
      .select({ userId: itemAccess.userId })
      .from(itemAccess)
      .where(and(eq(itemAccess.itemId, itemId), eq(itemAccess.userId, userId)))
      .limit(1);
    return Boolean(r);
  }

  async function viewer(scope: TenantScope, projectId: string): Promise<CorrespondenceViewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
      // Outside users never get the staff-wide view, whatever level a custom template grants them.
      isAdmin:
        scope.ctx.principalType === 'member' &&
        (perms.orgRole === 'owner' ||
          perms.orgRole === 'admin' ||
          atLeast(perms.toolLevels.correspondence, 'admin')),
    };
  }

  const toView = (r: ItemRow, localToday: string, tz: string): ItemView => ({
    ...r,
    timeBarState: timeBarState(r, localToday),
    sentInTime: sentInTime({
      sentLocalDate: r.sentAt ? localDateOf(r.sentAt, tz) : null,
      timeBarDate: r.timeBarDate,
    }),
  });

  /** SQL form of `canSeeItem` for the register. */
  function visibleTo(v: CorrespondenceViewer): SQL | null {
    if (v.isAdmin) return null;
    const own = sql`${items.createdBy} = ${v.userId}`;
    // A private item is for the author, admins and the people on its list, and only once sent.
    const listed = sql`exists (select 1 from correspondence.item_access a
      where a.item_id = ${items.id} and a.user_id = ${v.userId})`;
    const open = sql`(not ${items.isPrivate} or ${listed})`;
    if (v.isInternal) return sql`(${own} or (${items.status} <> 'draft' and ${open}))`;
    if (!v.companyId)
      return sql`(${own} or (${items.isPrivate} and ${items.status} <> 'draft' and ${listed}))`;
    return sql`(${own} or (${items.status} <> 'draft' and ((not ${items.isPrivate} and (${items.fromCompanyId} = ${v.companyId}
      or ${v.companyId} = any(${items.toCompanyIds}))) or (${items.isPrivate} and ${listed}))))`;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: CorrespondenceStatus;
      typeId?: string;
      awaitingResponse?: boolean;
      q?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const project = await deps.platform.getProject(scope, projectId);
    const localToday = localDateOf(now(), project.timezone);
    const v = await viewer(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(items.projectId, projectId), isNull(items.deletedAt)];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(items.status, opts.status));
    if (opts.typeId) conditions.push(eq(items.typeId, opts.typeId));
    if (opts.awaitingResponse)
      conditions.push(sql`${items.responseRequired} and ${items.status} = 'sent'`);
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql`(${items.subject} ilike ${like} or ${items.numberLabel} ilike ${like})`);
    }
    if (after) conditions.push(gt(items.id, after.id));
    const rows = await scope.tx
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    return {
      data: page.data.map((r) => toView(r, localToday, project.timezone)),
      nextCursor: page.nextCursor,
    };
  }

  async function projectTypes(scope: TenantScope) {
    return listTypes(scope, { includeArchived: false });
  }

  async function getVisible(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.projectId, projectId), isNull(items.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('correspondence.not_found');
    const v = await viewer(scope, projectId);
    const onAccessList = row.isPrivate ? await isListed(scope, id, v.userId) : false;
    if (!canSeeItem({ ...row, onAccessList }, v)) throw new AppError('correspondence.not_found');
    const project = await deps.platform.getProject(scope, projectId);
    const view = toView(row, localDateOf(now(), project.timezone), project.timezone);
    const replies = await scope.tx
      .select()
      .from(responses)
      .where(eq(responses.itemId, id))
      .orderBy(asc(responses.sentAt), desc(responses.id));
    return { item: view, responses: replies, viewer: v, project };
  }

  const detail = async (scope: TenantScope, projectId: string, id: string) => {
    const { item, responses: replies, viewer: v } = await getVisible(scope, projectId, id);
    return { item, responses: replies, canManageAccess: canWriteDraft(item, v) };
  };

  async function checkFiles(scope: TenantScope, projectId: string, fileIds: string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
          { path: `fileIds/${i}`, message: 'Not a ready file in this project' },
        ]);
    }
  }

  async function checkSender(
    scope: TenantScope,
    projectId: string,
    companyId: string | null | undefined,
  ) {
    if (!companyId) return;
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError(
        'correspondence.recipient_not_on_project',
        'The sending company must be on this project.',
        [{ path: 'fromCompanyId', message: 'Not a company on this project' }],
      );
  }

  async function checkRecipients(scope: TenantScope, projectId: string, companyIds: string[]) {
    if (!companyIds.length) return;
    const onProject = new Set(
      (await deps.platform.projectCompanies(scope, projectId)).map((c) => c.id),
    );
    for (const [i, id] of companyIds.entries())
      if (!onProject.has(id))
        throw new AppError(
          'correspondence.recipient_not_on_project',
          'Recipients must be companies on this project.',
          [{ path: `toCompanyIds/${i}`, message: 'Not a company on this project' }],
        );
  }

  const hashOf = (r: ItemRow, sentAt: Date) =>
    createHash('sha256')
      .update(
        JSON.stringify({
          id: r.id,
          number: r.numberLabel,
          typeId: r.typeId,
          type: r.typeName,
          subject: r.subject,
          body: r.body,
          from: r.fromCompanyId,
          to: [...r.toCompanyIds].sort(),
          files: r.fileIds,
          eventDate: r.eventDate,
          timeBarDays: r.timeBarDays,
          timeBarDate: r.timeBarDate,
          dueDate: r.dueDate,
          responseRequired: r.responseRequired,
          related: r.related,
          sentAt: sentAt.toISOString(),
        }),
      )
      .digest('hex');

  function checkValues(defs: FieldDefinition[], values: Record<string, unknown>, forSend: boolean) {
    const r = checkFieldValues(defs, values, { forSend });
    if (r.problems.length)
      throw new AppError('validation_failed', 'These details are not valid.', r.problems);
    return r.values;
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: ItemFields & { typeId: string },
  ) {
    const v = await viewer(scope, projectId);
    const project = await deps.platform.getProject(scope, projectId);
    const type = await getType(scope, input.typeId);
    if (type.archivedAt)
      throw new AppError('correspondence_type.archived', 'That type is no longer in use.');
    await checkRecipients(scope, projectId, input.toCompanyIds ?? []);
    if (v.isInternal) await checkSender(scope, projectId, input.fromCompanyId);
    if (input.fileIds?.length) await checkFiles(scope, projectId, input.fileIds);
    const fieldValues = checkValues(type.fields, input.fieldValues ?? {}, false);
    const number = await nextNumber(scope, projectId, `correspondence:${type.id}`);
    const label = `${type.prefix}-${String(number).padStart(3, '0')}`;
    const localToday = localDateOf(now(), project.timezone);
    const barDays = input.timeBarDays !== undefined ? input.timeBarDays : type.timeBarDays;
    const vars = {
      projectName: project.name,
      number: label,
      date: auDate(localToday),
      eventDate: input.eventDate ? auDate(input.eventDate) : '[date]',
    };
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(items)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        typeId: type.id,
        typeName: type.name,
        isEvidential: type.isEvidential,
        number,
        numberLabel: label,
        subject: input.subject?.trim() ?? renderTemplate(type.subjectTemplate, vars),
        body: input.body ?? renderTemplate(type.bodyTemplate, vars),
        status: 'draft',
        // Outside users can only write on behalf of their own company; staff may name one.
        fromCompanyId: v.isInternal ? (input.fromCompanyId ?? v.companyId) : v.companyId,
        toCompanyIds: [...new Set(input.toCompanyIds ?? [])],
        responseRequired: input.responseRequired ?? type.responseRequired,
        dueDate: input.dueDate ?? null,
        eventDate: input.eventDate ?? null,
        timeBarDays: barDays,
        timeBarDate: timeBarDate(input.eventDate ?? null, barDays),
        fileIds: input.fileIds ?? [],
        related: input.related ?? [],
        isPrivate: input.isPrivate ?? false,
        fieldValues,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'correspondence.item.created.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: 1,
      data: { itemId: id, number: row!.numberLabel, typeId: type.id },
    });
    await record(scope, id, 'created');
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: ItemFields,
  ) {
    const { item, viewer: v } = await getVisible(scope, projectId, id);
    if (!canEditItem(item.status))
      throw new AppError(
        'correspondence.invalid_transition',
        `A ${item.status} item can't be edited.`,
        undefined,
        { status: item.status },
      );
    if (!canWriteDraft(item, v)) throw new AppError('access.denied', "You can't change this item.");
    if (item.version !== expectedVersion) throw versionConflict();
    if (patch.toCompanyIds) await checkRecipients(scope, projectId, patch.toCompanyIds);
    await checkSender(scope, projectId, patch.fromCompanyId);
    if (patch.fileIds?.length) await checkFiles(scope, projectId, patch.fileIds);
    if (!v.isInternal && patch.fromCompanyId !== undefined && patch.fromCompanyId !== v.companyId)
      throw new AppError('access.denied', 'Only the builder can change the sending company.');
    const set: Partial<typeof items.$inferInsert> = {};
    if (patch.isPrivate !== undefined) set.isPrivate = patch.isPrivate;
    if (patch.fieldValues !== undefined) {
      const type = await getType(scope, item.typeId);
      const merged: Record<string, unknown> = { ...item.fieldValues, ...patch.fieldValues };
      set.fieldValues = checkValues(type.fields, merged, false);
    }
    if (patch.subject !== undefined) set.subject = patch.subject.trim();
    if (patch.body !== undefined) set.body = patch.body;
    if (patch.fromCompanyId !== undefined) set.fromCompanyId = patch.fromCompanyId;
    if (patch.toCompanyIds !== undefined) set.toCompanyIds = [...new Set(patch.toCompanyIds)];
    if (patch.responseRequired !== undefined) set.responseRequired = patch.responseRequired;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.fileIds !== undefined) set.fileIds = patch.fileIds;
    if (patch.related !== undefined) set.related = patch.related;
    if (patch.eventDate !== undefined || patch.timeBarDays !== undefined) {
      const eventDate = patch.eventDate !== undefined ? patch.eventDate : item.eventDate;
      const days = patch.timeBarDays !== undefined ? patch.timeBarDays : item.timeBarDays;
      set.eventDate = eventDate;
      set.timeBarDays = days;
      set.timeBarDate = timeBarDate(eventDate, days);
    }
    const [row] = await scope.tx
      .update(items)
      .set({ ...set, version: item.version + 1, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    const changes: HistoryChange[] = [];
    for (const [field, to] of Object.entries(set)) {
      const from = (item as Record<string, unknown>)[field];
      if (!same(from, to)) changes.push({ field, from, to });
    }
    if (changes.length) await record(scope, id, 'edited', changes);
    scope.events.add({
      type: 'correspondence.item.updated.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: row.version,
      data: { itemId: id, changed: Object.keys(patch) },
    });
    return detail(scope, projectId, id);
  }

  /**
   * Sends the item: it needs a subject, a body and at least one recipient. An evidential item is stamped with
   * a hash of what was sent and can never be edited or voided afterwards (SCH-AC5).
   */
  async function send(scope: TenantScope, projectId: string, id: string, expectedVersion: number) {
    const { item, viewer: v, project } = await getVisible(scope, projectId, id);
    if (!canSend(item.status))
      throw new AppError(
        'correspondence.invalid_transition',
        `A ${item.status} item can't be sent.`,
        undefined,
        { status: item.status },
      );
    if (!canWriteDraft(item, v)) throw new AppError('access.denied', "You can't send this item.");
    if (item.version !== expectedVersion) throw versionConflict();
    const missing: Array<{ path: string; message: string }> = [];
    if (!item.subject.trim()) missing.push({ path: 'subject', message: 'Required to send' });
    if (!item.body.trim()) missing.push({ path: 'body', message: 'Required to send' });
    if (!item.toCompanyIds.length)
      missing.push({ path: 'toCompanyIds', message: 'Required to send' });
    if (!item.fromCompanyId) missing.push({ path: 'fromCompanyId', message: 'Required to send' });
    const sendType = await getType(scope, item.typeId);
    missing.push(
      ...checkFieldValues(sendType.fields, item.fieldValues, { forSend: true }).problems,
    );
    if (missing.length)
      throw new AppError(
        'correspondence.incomplete',
        'Finish the notice before sending it.',
        missing,
      );
    const sentAt = now();
    const sentLocal = localDateOf(sentAt, project.timezone);
    let dueDate = item.dueDate;
    if (item.responseRequired && !dueDate) {
      const type = await getType(scope, item.typeId);
      dueDate = dueDateFor(sentLocal, type.responseDays);
    }
    const [row] = await scope.tx
      .update(items)
      .set({
        status: 'sent',
        sentAt,
        sentBy: scope.ctx.userId,
        dueDate,
        contentHash: item.isEvidential ? hashOf({ ...item, dueDate }, sentAt) : null,
        version: item.version + 1,
        updatedAt: sentAt,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await record(scope, id, 'sent');
    scope.events.add({
      type: 'correspondence.item.sent.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: row.version,
      data: {
        itemId: id,
        number: row.numberLabel,
        typeName: row.typeName,
        toCompanyIds: row.toCompanyIds,
        responseRequired: row.responseRequired,
        dueDate: row.dueDate,
        isEvidential: row.isEvidential,
        sentInTime: sentInTime({ sentLocalDate: sentLocal, timeBarDate: row.timeBarDate }),
      },
    });
    return detail(scope, projectId, id);
  }

  /** A reply or follow-up from either side. A reply from a receiving company marks the item responded. */
  async function respond(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { body: string; fileIds: string[] },
  ) {
    const { item, viewer: v } = await getVisible(scope, projectId, id);
    if (!canRespond(item.status))
      throw new AppError(
        'correspondence.invalid_transition',
        `A ${item.status} item can't take a response.`,
        undefined,
        { status: item.status },
      );
    if (!canRespondAs(item, v))
      throw new AppError('correspondence.response_not_allowed', "You can't respond to this item.");
    if (!input.body.trim())
      throw new AppError('validation_failed', 'Write a response.', [
        { path: 'body', message: 'Required' },
      ]);
    if (input.fileIds.length) await checkFiles(scope, projectId, input.fileIds);
    const responseId = uuidv7();
    await scope.tx.insert(responses).values({
      id: responseId,
      orgId: scope.ctx.orgId,
      itemId: id,
      authorId: scope.ctx.userId,
      authorCompanyId: v.companyId,
      body: input.body.trim(),
      fileIds: input.fileIds,
      sentAt: now(),
    });
    await record(scope, id, 'responded');
    const fromReceiver = v.companyId !== null && item.toCompanyIds.includes(v.companyId);
    if (fromReceiver && item.status === 'sent') {
      await scope.tx
        .update(items)
        .set({
          status: 'responded',
          version: item.version + 1,
          updatedAt: now(),
          updatedBy: scope.ctx.userId,
        })
        .where(eq(items.id, id));
    }
    scope.events.add({
      type: 'correspondence.response.added.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: fromReceiver && item.status === 'sent' ? item.version + 1 : item.version,
      data: { itemId: id, responseId, number: item.numberLabel, fromReceiver },
    });
    return detail(scope, projectId, id);
  }

  async function close(scope: TenantScope, projectId: string, id: string, expectedVersion: number) {
    const { item } = await getVisible(scope, projectId, id);
    if (!canClose(item.status))
      throw new AppError(
        'correspondence.invalid_transition',
        `A ${item.status} item can't be closed.`,
        undefined,
        { status: item.status },
      );
    if (item.version !== expectedVersion) throw versionConflict();
    const [row] = await scope.tx
      .update(items)
      .set({
        status: 'closed',
        closedAt: now(),
        version: item.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await record(scope, id, 'closed');
    scope.events.add({
      type: 'correspondence.item.closed.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: row.version,
      data: { itemId: id, number: row.numberLabel },
    });
    return detail(scope, projectId, id);
  }

  async function voidItem(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    reason: string,
  ) {
    const { item } = await getVisible(scope, projectId, id);
    if (!canVoid(item.status, item.isEvidential))
      throw new AppError(
        'correspondence.invalid_transition',
        item.isEvidential && item.status !== 'void'
          ? "A notice that has been sent can't be voided; close it instead."
          : `A ${item.status} item can't be voided.`,
        undefined,
        { status: item.status },
      );
    if (!reason.trim())
      throw new AppError('validation_failed', 'Give a reason.', [
        { path: 'reason', message: 'Required' },
      ]);
    if (item.version !== expectedVersion) throw versionConflict();
    const [row] = await scope.tx
      .update(items)
      .set({
        status: 'void',
        voidReason: reason.trim(),
        version: item.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await record(scope, id, 'voided', [{ field: 'voidReason', from: null, to: reason.trim() }]);
    scope.events.add({
      type: 'correspondence.item.voided.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: row.version,
      data: { itemId: id, number: row.numberLabel },
    });
    return detail(scope, projectId, id);
  }

  /** Who may open a private item. Only the author or an admin sees or changes it. */
  async function getAccess(scope: TenantScope, projectId: string, id: string) {
    const { item, viewer: v } = await getVisible(scope, projectId, id);
    if (!canWriteDraft(item, v))
      throw new AppError('access.denied', "You can't see who has access.");
    const rows = await scope.tx
      .select({ userId: itemAccess.userId })
      .from(itemAccess)
      .where(eq(itemAccess.itemId, id))
      .orderBy(asc(itemAccess.addedAt), asc(itemAccess.userId));
    return { isPrivate: item.isPrivate, userIds: rows.map((r) => r.userId) };
  }

  /**
   * Sets the private flag and replaces the list of people who may open the item. Works at any stage, since it
   * changes who sees the item, not what it says; the change is recorded. Listed people must be on the project.
   */
  async function setAccess(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { isPrivate: boolean; userIds: string[] },
  ) {
    const { item, viewer: v } = await getVisible(scope, projectId, id);
    if (!canWriteDraft(item, v))
      throw new AppError('access.denied', "You can't change who has access.");
    if (item.status === 'void')
      throw new AppError(
        'correspondence.invalid_transition',
        "A void item can't be changed.",
        undefined,
        {
          status: item.status,
        },
      );
    const userIds = [...new Set(input.userIds)];
    for (const [i, userId] of userIds.entries()) {
      if (!(await deps.platform.getProjectMembership(scope, projectId, userId)))
        throw new AppError('validation_failed', 'Only people on this project can be listed.', [
          { path: `userIds/${i}`, message: 'Not on this project' },
        ]);
    }
    const before = await getAccess(scope, projectId, id);
    await scope.tx.delete(itemAccess).where(eq(itemAccess.itemId, id));
    if (userIds.length)
      await scope.tx.insert(itemAccess).values(
        userIds.map((userId) => ({
          itemId: id,
          orgId: scope.ctx.orgId,
          userId,
          addedBy: scope.ctx.userId,
        })),
      );
    const [row] = await scope.tx
      .update(items)
      .set({
        isPrivate: input.isPrivate,
        version: sql`${items.version} + 1`,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(items.id, id))
      .returning();
    const changes: HistoryChange[] = [];
    if (before.isPrivate !== input.isPrivate)
      changes.push({ field: 'isPrivate', from: before.isPrivate, to: input.isPrivate });
    if (!same([...before.userIds].sort(), [...userIds].sort()))
      changes.push({ field: 'accessUserIds', from: before.userIds, to: userIds });
    if (changes.length) await record(scope, id, 'access_changed', changes);
    scope.events.add({
      type: 'correspondence.item.access_changed.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: row!.version,
      data: { itemId: id, isPrivate: input.isPrivate, people: userIds.length },
    });
    return { isPrivate: input.isPrivate, userIds };
  }

  /** The item's change history, oldest first, for anyone who can open the item. */
  async function history(scope: TenantScope, projectId: string, id: string) {
    await getVisible(scope, projectId, id);
    return scope.tx
      .select()
      .from(itemHistory)
      .where(eq(itemHistory.itemId, id))
      .orderBy(asc(itemHistory.at), asc(itemHistory.id));
  }

  /** Global search (`search`): the correspondence the caller can see that matches the words. */
  async function searchHits(scope: TenantScope, projectId: string, q: string, limit: number) {
    if (!(await deps.access.can(scope, 'correspondence.items.read', { projectId })))
      return { restricted: true, hits: [] as SearchHit[] };
    const page = await list(scope, projectId, { q, limit });
    return {
      restricted: false,
      hits: page.data.map<SearchHit>((r) => ({
        id: r.id,
        ref: r.numberLabel,
        title: r.subject,
        status: r.status,
      })),
    };
  }

  return {
    searchHits,
    templates,
    listTypes,
    projectTypes,
    createType,
    updateType,
    list,
    detail,
    create,
    update,
    send,
    respond,
    close,
    voidItem,
    getAccess,
    setAccess,
    history,
  };
}

export type CorrespondenceService = ReturnType<typeof createCorrespondenceService>;
