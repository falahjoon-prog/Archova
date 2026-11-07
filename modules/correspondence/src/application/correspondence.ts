import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
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
  canBePrivate,
  canClose,
  canEditItem,
  canManageAccess,
  canRespond,
  canRespondAs,
  canSeeItem,
  canSend,
  canWriteDraft,
  canVoid,
  checkFieldDefs,
  diffFieldValues,
  diffItem,
  dueDateFor,
  mergeFieldValues,
  missingRequiredFields,
  renderTemplate,
  sentInTime,
  timeBarDate,
  timeBarState,
  type CorrespondenceStatus,
  type CorrespondenceViewer,
  type FieldChange,
  type FieldDef,
  type FieldValue,
  type RelatedLink,
} from '../domain/correspondence';
import { TYPE_TEMPLATES, findTemplate } from '../domain/templates';
import { itemAccess, itemEmails, itemHistory, items, responses, types } from '../infra/tables';

export type TypeRow = typeof types.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
export type HistoryRow = typeof itemHistory.$inferSelect;
export type EmailRow = typeof itemEmails.$inferSelect;
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
  fieldDefs?: FieldDef[];
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
  /** Values of the type's own fields; `null` clears one. */
  fields?: Record<string, FieldValue | null>;
}

/** Fields whose changes the history records. */
const TRACKED = [
  'subject',
  'body',
  'fromCompanyId',
  'toCompanyIds',
  'responseRequired',
  'dueDate',
  'eventDate',
  'timeBarDays',
  'fileIds',
  'related',
] as const;

/** Most emails one item may queue in an hour, so the mail log cannot be used to spam people. */
const EMAILS_PER_HOUR = 100;
export const MAX_EMAIL_RECIPIENTS = 20;

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

  function assertFieldDefs(defs: FieldDef[]) {
    const problems = checkFieldDefs(defs);
    if (problems.length) throw new AppError('validation_failed', 'Check the fields.', problems);
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
    if (input.fieldDefs) assertFieldDefs(input.fieldDefs);
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
        fieldDefs: input.fieldDefs ?? [],
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
    if (patch.fieldDefs !== undefined) {
      assertFieldDefs(patch.fieldDefs);
      set.fieldDefs = patch.fieldDefs;
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
    const listed = sql`exists (select 1 from ${itemAccess} a
      where a.item_id = ${items.id} and a.user_id = ${v.userId})`;
    const audience = v.isInternal
      ? sql`true`
      : v.companyId
        ? sql`(${items.fromCompanyId} = ${v.companyId} or ${v.companyId} = any(${items.toCompanyIds}))`
        : sql`false`;
    return sql`(${own} or (${items.status} <> 'draft'
      and (case when ${items.isPrivate} then ${listed} else ${audience} end)))`;
  }

  async function accessIds(scope: TenantScope, itemId: string): Promise<string[]> {
    const rows = await scope.tx
      .select({ userId: itemAccess.userId })
      .from(itemAccess)
      .where(eq(itemAccess.itemId, itemId));
    return rows.map((r) => r.userId);
  }

  /** One line in the item's change history, written in the same transaction as the change. */
  async function log(
    scope: TenantScope,
    itemId: string,
    action: string,
    changes: FieldChange[] = [],
  ) {
    await scope.tx.insert(itemHistory).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      itemId,
      at: now(),
      actorId: scope.ctx.userId,
      action,
      changes,
    });
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
    const listed = row.isPrivate ? await accessIds(scope, id) : [];
    if (!canSeeItem({ ...row, accessUserIds: listed }, v))
      throw new AppError('correspondence.not_found');
    const project = await deps.platform.getProject(scope, projectId);
    const view = toView(row, localDateOf(now(), project.timezone), project.timezone);
    const replies = await scope.tx
      .select()
      .from(responses)
      .where(eq(responses.itemId, id))
      .orderBy(asc(responses.sentAt), desc(responses.id));
    return { item: view, responses: replies, viewer: v, project, accessUserIds: listed };
  }

  const detail = async (scope: TenantScope, projectId: string, id: string) => {
    const { item, responses: replies } = await getVisible(scope, projectId, id);
    return { item, responses: replies };
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
          fields: r.fields,
          sentAt: sentAt.toISOString(),
        }),
      )
      .digest('hex');

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
    const merged = mergeFieldValues(type.fieldDefs, {}, input.fields ?? {});
    if (merged.problems.length)
      throw new AppError('validation_failed', 'Check the fields.', merged.problems);
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
        fieldDefs: type.fieldDefs,
        fields: merged.values,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await log(scope, id, 'created');
    scope.events.add({
      type: 'correspondence.item.created.v1',
      projectId,
      entityType: 'correspondence',
      entityId: id,
      entityVersion: 1,
      data: { itemId: id, number: row!.numberLabel, typeId: type.id },
    });
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
    if (patch.fields) {
      const merged = mergeFieldValues(item.fieldDefs, item.fields, patch.fields);
      if (merged.problems.length)
        throw new AppError('validation_failed', 'Check the fields.', merged.problems);
      set.fields = merged.values;
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
    await log(scope, id, 'updated', [
      ...diffItem(item, row, TRACKED),
      ...diffFieldValues(item.fields, row.fields),
    ]);
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
    missing.push(...missingRequiredFields(item.fieldDefs, item.fields));
    if (item.isPrivate && !canBePrivate({ isEvidential: item.isEvidential, status: 'sent' }))
      missing.push({
        path: 'isPrivate',
        message: 'A notice that binds the company has to reach the other side; make it not private',
      });
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
    await log(scope, id, 'sent');
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
    await log(scope, id, 'responded');
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
    await log(scope, id, 'closed');
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
    await log(scope, id, 'voided', [{ field: 'voidReason', to: reason.trim().slice(0, 200) }]);
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

  // ---- who can see it, history and emails --------------------------------------------------------------------

  async function access(scope: TenantScope, projectId: string, id: string) {
    const { item } = await getVisible(scope, projectId, id);
    const rows = await scope.tx
      .select()
      .from(itemAccess)
      .where(eq(itemAccess.itemId, id))
      .orderBy(asc(itemAccess.addedAt), asc(itemAccess.userId));
    const users = [];
    for (const r of rows) {
      const m = await deps.platform.getProjectMembership(scope, projectId, r.userId);
      users.push({ userId: r.userId, companyId: m?.companyId ?? null, addedAt: r.addedAt });
    }
    return { isPrivate: item.isPrivate, users };
  }

  /**
   * Makes an item private or public and sets who is on its permissions list. The author and the correspondence
   * admins always see it. Only the author or an admin can change this, at any stage, but a notice that binds the
   * company is never hidden once it is sent.
   */
  async function setAccess(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { isPrivate: boolean; userIds: string[] },
  ) {
    const { item, viewer: v, accessUserIds } = await getVisible(scope, projectId, id);
    if (!canManageAccess(item, v))
      throw new AppError('access.denied', "You can't change who sees this item.");
    if (item.status === 'void')
      throw new AppError(
        'correspondence.invalid_transition',
        "A void item can't be changed.",
        undefined,
        { status: item.status },
      );
    if (input.isPrivate && !canBePrivate(item))
      throw new AppError(
        'correspondence.cannot_be_private',
        'A notice that has been sent has to stay visible to the other side.',
      );
    const userIds = [...new Set(input.userIds)];
    for (const [i, userId] of userIds.entries()) {
      if (!(await deps.platform.getProjectMembership(scope, projectId, userId)))
        throw new AppError(
          'correspondence.recipient_not_on_project',
          'Add people on this project.',
          [{ path: `userIds/${i}`, message: 'Not a member of this project' }],
        );
    }
    const before = new Set(accessUserIds.length ? accessUserIds : await accessIds(scope, id));
    const removed = [...before].filter((u) => !userIds.includes(u));
    const added = userIds.filter((u) => !before.has(u));
    if (removed.length)
      await scope.tx
        .delete(itemAccess)
        .where(and(eq(itemAccess.itemId, id), inArray(itemAccess.userId, removed)));
    if (added.length)
      await scope.tx.insert(itemAccess).values(
        added.map((userId) => ({
          itemId: id,
          orgId: scope.ctx.orgId,
          userId,
          addedBy: scope.ctx.userId,
          addedAt: now(),
        })),
      );
    if (input.isPrivate !== item.isPrivate)
      await scope.tx
        .update(items)
        .set({ isPrivate: input.isPrivate })
        .where(and(eq(items.id, id), eq(items.projectId, projectId)));
    const changes: FieldChange[] = [];
    if (input.isPrivate !== item.isPrivate)
      changes.push({ field: 'isPrivate', from: item.isPrivate, to: input.isPrivate });
    if (added.length || removed.length)
      changes.push({ field: 'permissions', from: before.size, to: userIds.length });
    if (changes.length) {
      await log(scope, id, 'access_changed', changes);
      scope.events.add({
        type: 'correspondence.item.access_changed.v1',
        projectId,
        entityType: 'correspondence',
        entityId: id,
        entityVersion: item.version,
        data: { itemId: id, number: item.numberLabel, isPrivate: input.isPrivate },
      });
    }
    return access(scope, projectId, id);
  }

  /** What happened to the item, oldest first, for anyone who can see it. */
  async function history(scope: TenantScope, projectId: string, id: string) {
    await getVisible(scope, projectId, id);
    return scope.tx
      .select()
      .from(itemHistory)
      .where(eq(itemHistory.itemId, id))
      .orderBy(asc(itemHistory.at), asc(itemHistory.id))
      .limit(500);
  }

  async function emails(scope: TenantScope, projectId: string, id: string) {
    await getVisible(scope, projectId, id);
    return scope.tx
      .select()
      .from(itemEmails)
      .where(eq(itemEmails.itemId, id))
      .orderBy(asc(itemEmails.createdAt), asc(itemEmails.id))
      .limit(500);
  }

  /**
   * Queues an email about a sent item to people on the project who could open it themselves. The worker sends
   * it: the mail names the item and carries the sender's note and a link, not the item's text.
   */
  async function emailItem(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { userIds: string[]; message: string },
  ) {
    const { item, accessUserIds } = await getVisible(scope, projectId, id);
    if (item.status === 'draft' || item.status === 'void')
      throw new AppError(
        'correspondence.invalid_transition',
        `A ${item.status} item can't be emailed.`,
        undefined,
        { status: item.status },
      );
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0 || userIds.length > MAX_EMAIL_RECIPIENTS)
      throw new AppError('validation_failed', `Choose 1 to ${MAX_EMAIL_RECIPIENTS} people.`, [
        { path: 'userIds', message: `Choose 1 to ${MAX_EMAIL_RECIPIENTS} people` },
      ]);
    const [{ n } = { n: 0 }] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(itemEmails)
      .where(
        and(
          eq(itemEmails.itemId, id),
          gte(itemEmails.createdAt, new Date(now().getTime() - 3_600_000)),
        ),
      );
    if (n + userIds.length > EMAILS_PER_HOUR)
      throw new AppError(
        'correspondence.email_limit',
        'Too many emails about this item. Try later.',
      );
    for (const [i, userId] of userIds.entries()) {
      const m = await deps.platform.getProjectMembership(scope, projectId, userId);
      const seen =
        m !== null &&
        canSeeItem(
          { ...item, accessUserIds },
          { userId, companyId: m.companyId, isInternal: !m.isExternal, isAdmin: false },
        );
      if (!seen)
        throw new AppError(
          'correspondence.recipient_cannot_see',
          'Email people who can open this item.',
          [{ path: `userIds/${i}`, message: "Can't open this item" }],
        );
    }
    const rows = await scope.tx
      .insert(itemEmails)
      .values(
        userIds.map((userId) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          itemId: id,
          senderId: scope.ctx.userId,
          recipientUserId: userId,
          message: input.message.trim(),
          createdAt: now(),
        })),
      )
      .returning();
    await log(scope, id, 'emailed', [{ field: 'recipients', to: userIds.length }]);
    return rows;
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
    access,
    setAccess,
    history,
    emails,
    emailItem,
  };
}

export type CorrespondenceService = ReturnType<typeof createCorrespondenceService>;
