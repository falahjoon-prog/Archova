import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
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
  closeBlockers,
  personKey,
  repeatSignatureFlags,
  suggestTopics,
  type RepeatReason,
  type TalkStatus,
  type TopicCategory,
} from '../domain/toolbox';
import { incidents, swms, toolboxAttendees, toolboxTalks, toolboxTopics } from '../infra/tables';
import type { SafetyDeps } from './swms';

export type TopicRow = typeof toolboxTopics.$inferSelect;
export type TalkRow = typeof toolboxTalks.$inferSelect;
export type AttendeeRow = typeof toolboxAttendees.$inferSelect;
export type AttendeeView = AttendeeRow & { repeatFlags: RepeatReason[] };

export interface TopicFields {
  title?: string;
  talkingPoints?: string;
  category?: TopicCategory;
  hrcwCategory?: string | null;
  isActive?: boolean;
}

export interface TalkFields {
  title?: string;
  topicId?: string | null;
  heldAt?: Date;
  location?: string | null;
  presenterName?: string;
  notes?: string | null;
}

export interface AttendeeInput {
  personName: string;
  companyId?: string | null;
  userId?: string | null;
}

const MAX_FUTURE_MS = 5 * 60_000;
const SUGGEST_WINDOW_DAYS = 30;

export function createToolboxService(deps: SafetyDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewerOf(scope: TenantScope, projectId: string) {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }
  type Viewer = Awaited<ReturnType<typeof viewerOf>>;

  async function requireManage(scope: TenantScope, projectId: string) {
    if (!(await deps.access.can(scope, 'safety.toolbox.manage', { projectId })))
      throw new AppError('access.denied', "You can't manage toolbox topics on this project.");
  }

  /** Builder staff see every talk; others see the ones they started and the ones their company attended. */
  function visibleTo(v: Viewer): SQL | null {
    if (v.isInternal) return null;
    const mine = sql`${toolboxTalks.createdBy} = ${v.userId}`;
    if (!v.companyId) return mine;
    return sql`(${mine} or exists (select 1 from safety.toolbox_attendees a where a.talk_id = ${toolboxTalks.id} and a.company_id = ${v.companyId}))`;
  }

  async function checkCompany(
    scope: TenantScope,
    projectId: string,
    companyId: string,
    path: string,
  ) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError('validation_failed', 'Name a company on this project.', [
        { path, message: 'Not a company on the project' },
      ]);
  }

  async function checkTopic(scope: TenantScope, projectId: string, topicId: string) {
    const [t] = await scope.tx
      .select({ id: toolboxTopics.id })
      .from(toolboxTopics)
      .where(and(eq(toolboxTopics.id, topicId), eq(toolboxTopics.projectId, projectId)))
      .limit(1);
    if (!t)
      throw new AppError('validation_failed', 'Pick a topic from this project.', [
        { path: 'topicId', message: 'Not a topic on the project' },
      ]);
  }

  function checkHeldAt(heldAt: Date) {
    if (heldAt.getTime() > now().getTime() + MAX_FUTURE_MS)
      throw new AppError(
        'validation_failed',
        'A talk that has been held cannot be in the future.',
        [{ path: 'heldAt', message: 'In the future' }],
      );
  }

  // --- Topics --------------------------------------------------------------------------------------------------

  async function listTopics(
    scope: TenantScope,
    projectId: string,
    opts: { includeInactive: boolean },
  ) {
    const rows = await scope.tx
      .select()
      .from(toolboxTopics)
      .where(
        and(
          eq(toolboxTopics.projectId, projectId),
          opts.includeInactive ? undefined : eq(toolboxTopics.isActive, true),
        ),
      )
      .orderBy(asc(toolboxTopics.title), asc(toolboxTopics.id));
    const last = await lastRunByTopic(scope, projectId);
    return rows.map((r) => ({ ...r, lastHeldAt: last.get(r.id) ?? null }));
  }

  async function lastRunByTopic(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({ topicId: toolboxTalks.topicId, at: sql<Date>`max(${toolboxTalks.heldAt})` })
      .from(toolboxTalks)
      .where(
        and(
          eq(toolboxTalks.projectId, projectId),
          isNull(toolboxTalks.deletedAt),
          sql`${toolboxTalks.topicId} is not null`,
        ),
      )
      .groupBy(toolboxTalks.topicId);
    return new Map(rows.map((r) => [r.topicId!, new Date(r.at)]));
  }

  async function createTopic(
    scope: TenantScope,
    projectId: string,
    input: TopicFields & { title: string },
  ) {
    await requireManage(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const [row] = await scope.tx
      .insert(toolboxTopics)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        title: input.title.trim(),
        talkingPoints: input.talkingPoints ?? '',
        category: input.category ?? 'general',
        hrcwCategory: input.hrcwCategory ?? null,
        isActive: input.isActive ?? true,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return { ...row!, lastHeldAt: null as Date | null };
  }

  async function updateTopic(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: TopicFields,
  ) {
    await requireManage(scope, projectId);
    const [cur] = await scope.tx
      .select()
      .from(toolboxTopics)
      .where(and(eq(toolboxTopics.id, id), eq(toolboxTopics.projectId, projectId)))
      .limit(1);
    if (!cur) throw new AppError('toolbox.topic_not_found');
    if (cur.version !== expectedVersion) throw versionConflict();
    const [row] = await scope.tx
      .update(toolboxTopics)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.talkingPoints !== undefined ? { talkingPoints: patch.talkingPoints } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.hrcwCategory !== undefined ? { hrcwCategory: patch.hrcwCategory } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: cur.version + 1,
      })
      .where(and(eq(toolboxTopics.id, id), eq(toolboxTopics.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    const last = await lastRunByTopic(scope, projectId);
    return { ...row, lastHeldAt: last.get(id) ?? null };
  }

  // --- Talks ---------------------------------------------------------------------------------------------------

  async function getVisible(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(toolboxTalks)
      .where(
        and(
          eq(toolboxTalks.id, id),
          eq(toolboxTalks.projectId, projectId),
          isNull(toolboxTalks.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('toolbox.not_found');
    const viewer = await viewerOf(scope, projectId);
    const vis = visibleTo(viewer);
    if (vis) {
      const [ok] = await scope.tx
        .select({ id: toolboxTalks.id })
        .from(toolboxTalks)
        .where(and(eq(toolboxTalks.id, id), vis))
        .limit(1);
      if (!ok) throw new AppError('toolbox.not_found');
    }
    return { row, viewer };
  }

  /** Builder staff run and edit any talk; others only a talk they started. */
  function assertCanEdit(row: TalkRow, v: Viewer) {
    if (!v.isInternal && row.createdBy !== v.userId)
      throw new AppError('access.denied', "You can't change this talk.");
  }

  async function attendeesOf(scope: TenantScope, row: TalkRow): Promise<AttendeeView[]> {
    const rows = await scope.tx
      .select()
      .from(toolboxAttendees)
      .where(eq(toolboxAttendees.talkId, row.id))
      .orderBy(asc(toolboxAttendees.createdAt), asc(toolboxAttendees.id));
    const hashes = [...new Set(rows.map((r) => r.signatureSha256).filter((h): h is string => !!h))];
    const earlier = hashes.length
      ? await scope.tx
          .select({
            id: toolboxAttendees.id,
            talkId: toolboxAttendees.talkId,
            personName: toolboxAttendees.personName,
            companyId: toolboxAttendees.companyId,
            signatureSha256: toolboxAttendees.signatureSha256,
          })
          .from(toolboxAttendees)
          .innerJoin(toolboxTalks, eq(toolboxTalks.id, toolboxAttendees.talkId))
          .where(
            and(
              eq(toolboxAttendees.projectId, row.projectId),
              ne(toolboxAttendees.talkId, row.id),
              inArray(toolboxAttendees.signatureSha256, hashes),
              lt(toolboxTalks.heldAt, row.heldAt),
              isNull(toolboxTalks.deletedAt),
            ),
          )
      : [];
    const flags = repeatSignatureFlags(
      rows.map((r) => ({
        id: r.id,
        talkId: r.talkId,
        personKey: personKey(r.personName, r.companyId),
        signatureSha256: r.signatureSha256,
      })),
      earlier.map((e) => ({
        id: e.id,
        talkId: e.talkId,
        personKey: personKey(e.personName, e.companyId),
        signatureSha256: e.signatureSha256,
      })),
    );
    return rows.map((r) => ({ ...r, repeatFlags: flags.get(r.id) ?? [] }));
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    const attendees = await attendeesOf(scope, row);
    const topic = row.topicId
      ? ((
          await scope.tx
            .select()
            .from(toolboxTopics)
            .where(eq(toolboxTopics.id, row.topicId))
            .limit(1)
        )[0] ?? null)
      : null;
    const blockers = row.status === 'open' ? closeBlockers(attendees) : [];
    return {
      talk: row,
      topic,
      attendees,
      closeBlockers: blockers,
      canEdit: viewer.isInternal || row.createdBy === viewer.userId,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: TalkStatus; topicId?: string; limit: number; cursor?: string },
  ) {
    const v = await viewerOf(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(toolboxTalks.projectId, projectId),
      isNull(toolboxTalks.deletedAt),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(toolboxTalks.status, opts.status));
    if (opts.topicId) conditions.push(eq(toolboxTalks.topicId, opts.topicId));
    if (after) conditions.push(lt(toolboxTalks.id, after.id));
    const rows = await scope.tx
      .select()
      .from(toolboxTalks)
      .where(and(...conditions))
      .orderBy(desc(toolboxTalks.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    const ids = page.data.map((r) => r.id);
    const counts = ids.length
      ? await scope.tx
          .select({
            talkId: toolboxAttendees.talkId,
            total: sql<number>`count(*)::int`,
            signed: sql<number>`count(${toolboxAttendees.signedAt})::int`,
          })
          .from(toolboxAttendees)
          .where(inArray(toolboxAttendees.talkId, ids))
          .groupBy(toolboxAttendees.talkId)
      : [];
    const by = new Map(counts.map((c) => [c.talkId, c]));
    return {
      data: page.data.map((r) => ({
        ...r,
        attendeeCount: by.get(r.id)?.total ?? 0,
        signedCount: by.get(r.id)?.signed ?? 0,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async function addRows(
    scope: TenantScope,
    projectId: string,
    talkId: string,
    people: AttendeeInput[],
  ) {
    for (const [i, p] of people.entries())
      if (p.companyId)
        await checkCompany(scope, projectId, p.companyId, `attendees.${i}.companyId`);
    for (const p of people) {
      const [dup] = await scope.tx
        .select({ id: toolboxAttendees.id })
        .from(toolboxAttendees)
        .where(
          and(
            eq(toolboxAttendees.talkId, talkId),
            sql`lower(${toolboxAttendees.personName}) = ${p.personName.trim().toLowerCase()}`,
            p.companyId
              ? eq(toolboxAttendees.companyId, p.companyId)
              : isNull(toolboxAttendees.companyId),
          ),
        )
        .limit(1);
      if (dup)
        throw new AppError(
          'toolbox.already_listed',
          `${p.personName.trim()} is already on this talk.`,
        );
      await scope.tx.insert(toolboxAttendees).values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        talkId,
        personName: p.personName.trim(),
        companyId: p.companyId ?? null,
        userId: p.userId ?? null,
        createdBy: scope.ctx.userId,
      });
    }
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: TalkFields & {
      title: string;
      heldAt: Date;
      presenterName: string;
      attendees?: AttendeeInput[];
    },
  ) {
    await deps.platform.getProject(scope, projectId);
    checkHeldAt(input.heldAt);
    if (input.topicId) await checkTopic(scope, projectId, input.topicId);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'toolbox_talk');
    await scope.tx.insert(toolboxTalks).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number,
      topicId: input.topicId ?? null,
      title: input.title.trim(),
      heldAt: input.heldAt,
      location: input.location ?? null,
      presenterName: input.presenterName.trim(),
      notes: input.notes ?? null,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    if (input.attendees?.length) await addRows(scope, projectId, id, input.attendees);
    return detail(scope, projectId, id);
  }

  async function openForChange(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
  ) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    assertCanEdit(row, viewer);
    if (row.version !== expectedVersion) throw versionConflict();
    if (row.status === 'closed') throw new AppError('toolbox.closed');
    return row;
  }

  async function bump(
    scope: TenantScope,
    row: TalkRow,
    set: Partial<typeof toolboxTalks.$inferInsert> = {},
  ) {
    const [next] = await scope.tx
      .update(toolboxTalks)
      .set({ ...set, updatedAt: now(), updatedBy: scope.ctx.userId, version: row.version + 1 })
      .where(and(eq(toolboxTalks.id, row.id), eq(toolboxTalks.version, row.version)))
      .returning();
    if (!next) throw versionConflict();
    return next;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: TalkFields,
  ) {
    const row = await openForChange(scope, projectId, id, expectedVersion);
    if (patch.heldAt) checkHeldAt(patch.heldAt);
    if (patch.topicId) await checkTopic(scope, projectId, patch.topicId);
    await bump(scope, row, {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.topicId !== undefined ? { topicId: patch.topicId } : {}),
      ...(patch.heldAt !== undefined ? { heldAt: patch.heldAt } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      ...(patch.presenterName !== undefined ? { presenterName: patch.presenterName.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    action: 'close' | 'reopen',
  ) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    assertCanEdit(row, viewer);
    if (row.version !== expectedVersion) throw versionConflict();
    if (action === 'close') {
      if (row.status === 'closed') throw new AppError('toolbox.closed');
      const blockers = closeBlockers(await attendeesOf(scope, row));
      if (blockers.length)
        throw new AppError('toolbox.cannot_close', blockers[0], [
          { path: 'attendees', message: blockers[0]! },
        ]);
      await bump(scope, row, { status: 'closed', closedAt: now(), closedBy: scope.ctx.userId });
    } else {
      if (row.status !== 'closed') throw new AppError('toolbox.not_closed');
      await requireManage(scope, projectId);
      await bump(scope, row, { status: 'open', closedAt: null, closedBy: null });
    }
    return detail(scope, projectId, id);
  }

  async function remove(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
  ) {
    const row = await openForChange(scope, projectId, id, expectedVersion);
    const signed = (await attendeesOf(scope, row)).some((a) => a.signedAt);
    if (signed) throw new AppError('toolbox.has_signatures');
    await scope.tx.delete(toolboxAttendees).where(eq(toolboxAttendees.talkId, id));
    await bump(scope, row, { deletedAt: now() });
  }

  // --- Attendance grid -----------------------------------------------------------------------------------------

  async function addAttendees(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    people: AttendeeInput[],
  ) {
    const row = await openForChange(scope, projectId, id, expectedVersion);
    await addRows(scope, projectId, id, people);
    await bump(scope, row);
    return detail(scope, projectId, id);
  }

  async function getAttendee(scope: TenantScope, talkId: string, attendeeId: string) {
    const [a] = await scope.tx
      .select()
      .from(toolboxAttendees)
      .where(and(eq(toolboxAttendees.id, attendeeId), eq(toolboxAttendees.talkId, talkId)))
      .limit(1);
    if (!a) throw new AppError('toolbox.attendee_not_found');
    return a;
  }

  /** One row signs with a drawn signature (a ready image file on the project). */
  async function sign(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    attendeeId: string,
    signatureFileId: string,
  ) {
    const row = await openForChange(scope, projectId, id, expectedVersion);
    const a = await getAttendee(scope, id, attendeeId);
    if (a.signedAt) throw new AppError('toolbox.already_signed');
    const f = await deps.files.getFile(scope, signatureFileId);
    if (f.projectId !== projectId || f.status !== 'ready' || !f.mime.startsWith('image/'))
      throw new AppError('file.not_in_project', 'Draw the signature again.', [
        { path: 'signatureFileId', message: 'Not a ready image in this project' },
      ]);
    await scope.tx
      .update(toolboxAttendees)
      .set({
        signedAt: now(),
        signedBy: scope.ctx.userId,
        signatureFileId,
        signatureSha256: f.sha256,
      })
      .where(eq(toolboxAttendees.id, attendeeId));
    await bump(scope, row);
    return detail(scope, projectId, id);
  }

  async function clearSignature(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    attendeeId: string,
  ) {
    const row = await openForChange(scope, projectId, id, expectedVersion);
    const a = await getAttendee(scope, id, attendeeId);
    if (!a.signedAt) throw new AppError('toolbox.not_signed');
    await scope.tx
      .update(toolboxAttendees)
      .set({ signedAt: null, signedBy: null, signatureFileId: null, signatureSha256: null })
      .where(eq(toolboxAttendees.id, attendeeId));
    await bump(scope, row);
    return detail(scope, projectId, id);
  }

  async function removeAttendee(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    attendeeId: string,
  ) {
    const row = await openForChange(scope, projectId, id, expectedVersion);
    const a = await getAttendee(scope, id, attendeeId);
    if (a.signedAt) throw new AppError('toolbox.has_signatures', 'Clear the signature first.');
    await scope.tx.delete(toolboxAttendees).where(eq(toolboxAttendees.id, attendeeId));
    await bump(scope, row);
    return detail(scope, projectId, id);
  }

  // --- Nova suggestions (rules, no model) ---------------------------------------------------------------------

  async function suggestions(scope: TenantScope, projectId: string) {
    // The rules read incident counts, which only builder staff may see.
    if (!(await viewerOf(scope, projectId)).isInternal) return [];
    const topics = await scope.tx
      .select()
      .from(toolboxTopics)
      .where(and(eq(toolboxTopics.projectId, projectId), eq(toolboxTopics.isActive, true)));
    const since = new Date(now().getTime() - SUGGEST_WINDOW_DAYS * 86_400_000);
    // Incidents are only counted as a number and a type, never named or described, so this is safe for any reader of talks.
    const inc = await scope.tx
      .select({ type: incidents.type, n: sql<number>`count(*)::int` })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, projectId),
          isNull(incidents.deletedAt),
          gte(incidents.occurredAt, since),
        ),
      )
      .groupBy(incidents.type);
    const cats = await scope.tx
      .select({ c: swms.highRiskWorkCategories })
      .from(swms)
      .where(
        and(eq(swms.projectId, projectId), eq(swms.status, 'accepted'), isNull(swms.deletedAt)),
      );
    return suggestTopics({
      topics: topics.map((t) => ({
        id: t.id,
        title: t.title,
        hrcwCategory: t.hrcwCategory,
        category: t.category,
      })),
      lastRun: await lastRunByTopic(scope, projectId),
      recentIncidentTypes: inc.map((i) => ({ type: i.type, count: i.n })),
      swmsCategories: cats.flatMap((c) => c.c),
      now: now(),
    });
  }

  return {
    listTopics,
    createTopic,
    updateTopic,
    list,
    detail,
    create,
    update,
    transition,
    remove,
    addAttendees,
    sign,
    clearSignature,
    removeAttendee,
    suggestions,
  };
}

export type ToolboxService = ReturnType<typeof createToolboxService>;
