import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import type {
  CreateMeetingItemRequest,
  CreateMeetingSeriesRequest,
  IssueMeetingRequest,
  MeetingAction,
  MeetingAgendaSection,
  MeetingDetail,
  MeetingItem,
  MeetingLink,
  MeetingPdf,
  MeetingPerson,
  MeetingSeries,
  MeetingSummary,
  UpdateMeetingItemRequest,
  UpdateMeetingRequest,
  UpdateMeetingSeriesRequest,
} from '@archova/contracts';
import { localDateOf, type LocalDate } from '@archova/time';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import {
  AGENDA_TEMPLATES,
  carryForward,
  defaultStatus,
  forAudience,
  isParty,
  isStale,
  itemNumber,
  sectionsFromAgenda,
  type MinutesView,
  type Viewer,
} from '../domain/minutes';
import {
  LIVE_LIMIT,
  weekOf,
  type LiveRow,
  type LiveSnapshot,
  type LiveSource,
} from '../domain/live';
import { renderMinutesPdf } from '../domain/pdf';
import {
  attendees,
  items,
  meetings,
  sections,
  series,
  versions,
  type Attendance,
  type DefaultAttendee,
  type LinkType,
} from '../infra/tables';

/** A register's list for a live section (MTG-US5): what `rfis`, `submittals` and `defects` hand over for the caller. */
export interface LiveSourceList {
  rows: Array<{ id: string; ref: string; title: string; detail: string }>;
  truncated: boolean;
  /** The caller can't read that register at all. */
  restricted: boolean;
}
type LiveReader = (
  scope: TenantScope,
  projectId: string,
  opts: { limit: number },
) => Promise<LiveSourceList>;

export interface MeetingsDeps {
  access: AccessService;
  live: {
    rfisOverdue: LiveReader;
    submittalsDue: LiveReader;
    defectsOpen: LiveReader;
    /** `diary.api.delayLines`: delay lines in the date range, or null when the caller sees only their company's lines. */
    delayLines: (
      scope: TenantScope,
      projectId: string,
      opts: { from: LocalDate; to: LocalDate; limit: number },
    ) => Promise<Array<{
      id: string;
      date: string;
      type: string;
      description: string;
      hours: string | number;
    }> | null>;
  };
  platform: Pick<
    PlatformApi,
    'getProject' | 'getProjectMembership' | 'projectCompanies' | 'getOrg'
  >;
  now?: () => Date;
}

type SeriesRow = typeof series.$inferSelect;
type MeetingRow = typeof meetings.$inferSelect;
type ItemRow = typeof items.$inferSelect;

/** What the route sends after the transaction commits: one plain-text notice per recipient. */
export interface IssueNotice {
  orgSlug: string;
  projectId: string;
  meetingId: string;
  title: string;
  version: number;
  correctionsBy: string | null;
  note: string | null;
  recipients: { name: string; email: string }[];
}

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

function ref(kind: IdKind, value: string, path: string) {
  const id = decodeId(kind, value);
  if (!id) throw invalid(path, 'Invalid id');
  return id;
}

const LINK_KIND: Record<LinkType, IdKind | null> = {
  rfi: 'rfi',
  defect: 'defect',
  variation: null,
};

function parseLink(link: MeetingLink, path: string) {
  const kind = LINK_KIND[link.type];
  const ok = kind ? decodeId(kind, link.id) !== null : /^[a-z]{3}_[0-9A-Za-z]{26}$/.test(link.id);
  if (!ok) throw invalid(path, 'Not an id of that kind');
  return { linkedType: link.type, linkedId: link.id };
}

export function createMeetingService(deps: MeetingsDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewer(scope: TenantScope, projectId: string): Promise<Viewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }

  /** Writing is the builder side's job; an outsider only reads what was issued to them (MTG-AC7). */
  async function internalViewer(scope: TenantScope, projectId: string) {
    const v = await viewer(scope, projectId);
    if (!v.isInternal)
      throw new AppError('meeting.not_allowed', 'Only the project team can change minutes.');
    return v;
  }

  const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
  const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

  // ---------------------------------------------------------------- people

  async function person(
    scope: TenantScope,
    projectId: string,
    p: MeetingPerson,
    path: string,
  ): Promise<DefaultAttendee> {
    const userId = p.userId ? ref('user', p.userId, `${path}/userId`) : null;
    const companyId = p.companyId ? ref('company', p.companyId, `${path}/companyId`) : null;
    if (userId && !(await deps.platform.getProjectMembership(scope, projectId, userId)))
      throw invalid(`${path}/userId`, 'Not a member of the project');
    return {
      name: p.name.trim(),
      companyName: (p.companyName ?? '').trim(),
      role: (p.role ?? '').trim(),
      email: p.email?.trim().toLowerCase() || null,
      userId,
      companyId,
    };
  }

  async function people(
    scope: TenantScope,
    projectId: string,
    list: readonly MeetingPerson[],
    path: string,
  ) {
    const out: DefaultAttendee[] = [];
    for (const [i, p] of list.entries())
      out.push(await person(scope, projectId, p, `${path}/${i}`));
    const onProject = out.some((p) => p.companyId)
      ? await deps.platform.projectCompanies(scope, projectId)
      : [];
    for (const [i, p] of out.entries())
      if (p.companyId && !onProject.some((c) => c.id === p.companyId))
        throw invalid(`${path}/${i}/companyId`, 'Not a company on the project');
    return out;
  }

  const personView = (p: DefaultAttendee) => ({
    name: p.name,
    companyName: p.companyName,
    role: p.role,
    email: p.email,
    userId: userOrNull(p.userId),
    companyId: companyOrNull(p.companyId),
  });

  // ---------------------------------------------------------------- series

  const seriesDto = (r: SeriesRow): MeetingSeries => ({
    id: encodeId('meetingSeries', r.id),
    projectId: encodeId('project', r.projectId),
    name: r.name,
    template: r.template,
    cadence: r.cadence,
    defaultAttendees: r.defaultAttendees.map(personView),
    agenda: r.agenda,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });

  async function getSeries(scope: TenantScope, projectId: string, seriesId: string) {
    const [row] = await scope.tx
      .select()
      .from(series)
      .where(
        and(eq(series.id, seriesId), eq(series.projectId, projectId), isNull(series.deletedAt)),
      )
      .limit(1);
    if (!row) throw new AppError('meeting.series_not_found');
    return row;
  }

  const cleanAgenda = (agenda: readonly MeetingAgendaSection[]) =>
    agenda
      .map((s) => ({ title: s.title.trim(), internalOnly: s.internalOnly }))
      .filter((s) => s.title);

  async function listSeries(
    scope: TenantScope,
    projectId: string,
  ): Promise<{ data: MeetingSeries[] }> {
    const v = await viewer(scope, projectId);
    // Default attendees carry email addresses, so outsiders don't get the series.
    if (!v.isInternal) return { data: [] };
    const rows = await scope.tx
      .select()
      .from(series)
      .where(and(eq(series.projectId, projectId), isNull(series.deletedAt)))
      .orderBy(asc(series.name), asc(series.id));
    return { data: rows.map(seriesDto) };
  }

  async function createSeries(
    scope: TenantScope,
    projectId: string,
    input: CreateMeetingSeriesRequest,
  ) {
    await internalViewer(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const template = input.template ?? 'custom';
    const agenda = input.agenda ? cleanAgenda(input.agenda) : [...AGENDA_TEMPLATES[template]];
    if (!agenda.length) throw invalid('agenda', 'Add at least one agenda section');
    const [row] = await scope.tx
      .insert(series)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: input.name.trim(),
        template,
        cadence: input.cadence?.trim() || null,
        defaultAttendees: await people(
          scope,
          projectId,
          input.defaultAttendees ?? [],
          'defaultAttendees',
        ),
        agenda,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return seriesDto(row!);
  }

  async function updateSeries(
    scope: TenantScope,
    projectId: string,
    seriesId: string,
    expected: number,
    patch: UpdateMeetingSeriesRequest,
  ) {
    await internalViewer(scope, projectId);
    const current = await getSeries(scope, projectId, seriesId);
    if (current.version !== expected) throw versionConflict();
    const agenda = patch.agenda ? cleanAgenda(patch.agenda) : undefined;
    if (agenda && !agenda.length) throw invalid('agenda', 'Add at least one agenda section');
    const [row] = await scope.tx
      .update(series)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.cadence !== undefined ? { cadence: patch.cadence?.trim() || null } : {}),
        ...(patch.defaultAttendees
          ? {
              defaultAttendees: await people(
                scope,
                projectId,
                patch.defaultAttendees,
                'defaultAttendees',
              ),
            }
          : {}),
        ...(agenda ? { agenda } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(series.id, seriesId), eq(series.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return seriesDto(row);
  }

  // ------------------------------------------------------------- meetings

  async function getMeetingRow(scope: TenantScope, projectId: string, meetingId: string) {
    const [row] = await scope.tx
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.id, meetingId),
          eq(meetings.projectId, projectId),
          isNull(meetings.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('meeting.not_found');
    return row;
  }

  async function createMeeting(
    scope: TenantScope,
    projectId: string,
    seriesId: string,
    input: { title?: string; heldAt: string; location?: string },
  ) {
    await internalViewer(scope, projectId);
    const s = await getSeries(scope, projectId, seriesId);
    const number = await nextNumber(scope, projectId, `meeting:${seriesId}`);
    const meetingId = uuidv7();
    const base = { orgId: scope.ctx.orgId, projectId };
    await scope.tx.insert(meetings).values({
      ...base,
      id: meetingId,
      seriesId,
      number,
      title: input.title?.trim() || `${s.name}, meeting ${number}`,
      heldAt: new Date(input.heldAt),
      location: input.location?.trim() ?? '',
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });

    // MTG-AC2: start from the previous meeting, with its open items, or from the series agenda for the first one.
    const [prev] = await scope.tx
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.seriesId, seriesId),
          isNull(meetings.deletedAt),
          lt(meetings.number, number),
        ),
      )
      .orderBy(desc(meetings.number))
      .limit(1);
    let start = sectionsFromAgenda(s.agenda);
    let carried: ReturnType<typeof carryForward>['items'] = [];
    const prevItems = new Map<string, ItemRow>();
    if (prev) {
      const prevSections = await scope.tx
        .select()
        .from(sections)
        .where(eq(sections.meetingId, prev.id));
      const rows = await scope.tx
        .select()
        .from(items)
        .where(and(eq(items.meetingId, prev.id), isNull(items.deletedAt)));
      const posOf = new Map(prevSections.map((x) => [x.id, x.position]));
      const plan = carryForward({
        sections: prevSections.map((x) => ({
          position: x.position,
          title: x.title,
          internalOnly: x.internalOnly,
          nextItem: x.nextItem,
          liveSource: x.liveSource,
        })),
        items: rows.map((r) => ({
          id: r.id,
          sectionPosition: posOf.get(r.sectionId)!,
          threadId: r.threadId,
          carriedCount: r.carriedCount,
          status: r.status,
        })),
      });
      start = plan.sections;
      carried = plan.items;
      for (const r of rows) prevItems.set(r.id, r);
    }
    const sectionIds = new Map<number, string>();
    if (start.length) {
      const created = start.map((x) => ({
        ...base,
        id: uuidv7(),
        meetingId,
        position: x.position,
        title: x.title,
        internalOnly: x.internalOnly,
        nextItem: x.nextItem,
        liveSource: x.liveSource ?? null,
      }));
      await scope.tx.insert(sections).values(created);
      for (const c of created) sectionIds.set(c.position, c.id);
    }
    if (carried.length) {
      await scope.tx.insert(items).values(
        carried.map((c) => {
          const from = prevItems.get(c.fromId)!;
          return {
            ...base,
            id: uuidv7(),
            meetingId,
            sectionId: sectionIds.get(c.sectionPosition)!,
            threadId: c.threadId,
            carriedFromId: from.id,
            carriedCount: c.carriedCount,
            itemNo: from.itemNo,
            seq: from.seq,
            kind: from.kind,
            body: from.body,
            status: 'open' as const,
            ownerCompanyId: from.ownerCompanyId,
            ownerUserId: from.ownerUserId,
            ownerName: from.ownerName,
            dueDate: from.dueDate,
            linkedType: from.linkedType,
            linkedId: from.linkedId,
            createdBy: scope.ctx.userId,
            updatedBy: scope.ctx.userId,
          };
        }),
      );
    }
    if (s.defaultAttendees.length)
      await scope.tx.insert(attendees).values(
        s.defaultAttendees.map((a, i) => ({
          ...base,
          id: uuidv7(),
          meetingId,
          position: i + 1,
          name: a.name,
          companyName: a.companyName,
          role: a.role,
          email: a.email,
          userId: a.userId,
          companyId: a.companyId,
        })),
      );
    scope.events.add({
      type: 'meetings.meeting.created.v1',
      projectId,
      entityType: 'meeting',
      entityId: meetingId,
      entityVersion: 1,
      data: { meetingId, seriesId, number, carriedItems: carried.length },
    });
    return detail(scope, projectId, meetingId);
  }

  /** The working minutes in the API's shape, with each item's earlier appearances. */
  // ------------------------------------------------------------ live sections

  /**
   * MTG-US5: the register list for a live section, read as the caller (their access applies). It is read each time the
   * working minutes are opened; issuing freezes it into the version snapshot, so an issued version shows the list as it
   * was in the meeting (MTG-AC6).
   */
  async function liveSnapshot(
    scope: TenantScope,
    projectId: string,
    source: LiveSource,
  ): Promise<LiveSnapshot> {
    const asOf = now().toISOString();
    const opts = { limit: LIVE_LIMIT };
    const fromList = (
      list: LiveSourceList,
      type: 'rfi' | 'defect' | 'submittal',
      kind: 'rfi' | 'defect' | 'submittal',
    ): LiveSnapshot => ({
      source,
      asOf,
      truncated: list.truncated,
      restricted: list.restricted,
      rows: list.rows.map((r): LiveRow => ({
        ref: r.ref,
        title: r.title,
        detail: r.detail,
        link: { type, id: encodeId(kind, r.id) },
      })),
    });
    switch (source) {
      case 'rfis_overdue':
        return fromList(await deps.live.rfisOverdue(scope, projectId, opts), 'rfi', 'rfi');
      case 'submittals_due':
        return fromList(
          await deps.live.submittalsDue(scope, projectId, opts),
          'submittal',
          'submittal',
        );
      case 'defects_open':
        return fromList(await deps.live.defectsOpen(scope, projectId, opts), 'defect', 'defect');
      case 'delays_week': {
        const empty = { source, asOf, rows: [], truncated: false };
        if (!(await deps.access.can(scope, 'diary.entries.read', { projectId })))
          return { ...empty, restricted: true };
        const project = await deps.platform.getProject(scope, projectId);
        const { from, to } = weekOf(localDateOf(now(), project.timezone));
        const lines = await deps.live.delayLines(scope, projectId, { from, to, limit: LIVE_LIMIT });
        if (!lines) return { ...empty, restricted: true };
        return {
          source,
          asOf,
          restricted: false,
          truncated: lines.length > LIVE_LIMIT,
          rows: lines.slice(0, LIVE_LIMIT).map((l) => ({
            ref: l.date,
            title: l.description || 'Delay',
            detail: `${Number(l.hours)} h, ${l.type.replace(/_/g, ' ')}`,
            link: null,
          })),
        };
      }
    }
  }

  async function liveBody(scope: TenantScope, m: MeetingRow, seriesName: string) {
    const [atts, secs, its] = await Promise.all([
      scope.tx
        .select()
        .from(attendees)
        .where(eq(attendees.meetingId, m.id))
        .orderBy(asc(attendees.position)),
      scope.tx
        .select()
        .from(sections)
        .where(eq(sections.meetingId, m.id))
        .orderBy(asc(sections.position)),
      scope.tx
        .select()
        .from(items)
        .where(and(eq(items.meetingId, m.id), isNull(items.deletedAt)))
        .orderBy(asc(items.seq), asc(items.id)),
    ]);
    const threads = [...new Set(its.filter((i) => i.carriedFromId).map((i) => i.threadId))];
    const earlier = threads.length
      ? await scope.tx
          .select({
            threadId: items.threadId,
            meetingId: items.meetingId,
            meetingNumber: meetings.number,
            heldAt: meetings.heldAt,
            itemNo: items.itemNo,
            body: items.body,
            status: items.status,
          })
          .from(items)
          .innerJoin(meetings, eq(items.meetingId, meetings.id))
          .where(
            and(
              inArray(items.threadId, threads),
              eq(meetings.seriesId, m.seriesId),
              lt(meetings.number, m.number),
              isNull(items.deletedAt),
              isNull(meetings.deletedAt),
            ),
          )
          .orderBy(asc(meetings.number))
      : [];
    const itemDto = (r: ItemRow): MeetingItem => ({
      id: encodeId('meetingItem', r.id),
      sectionId: encodeId('meetingSection', r.sectionId),
      threadId: encodeId('meetingItem', r.threadId),
      itemNo: r.itemNo,
      kind: r.kind,
      body: r.body,
      status: r.status,
      ownerCompanyId: companyOrNull(r.ownerCompanyId),
      ownerUserId: userOrNull(r.ownerUserId),
      ownerName: r.ownerName,
      dueDate: r.dueDate,
      link: r.linkedType && r.linkedId ? { type: r.linkedType, id: r.linkedId } : null,
      carriedCount: r.carriedCount,
      stale: isStale(r),
      history: earlier
        .filter((e) => e.threadId === r.threadId)
        .map((e) => ({
          meetingId: encodeId('meeting', e.meetingId),
          meetingNumber: e.meetingNumber,
          heldAt: e.heldAt.toISOString(),
          itemNo: e.itemNo,
          body: e.body,
          status: e.status,
        })),
      version: r.version,
    });
    return {
      meeting: meetingDto(m, seriesName),
      attendees: atts.map((a) => ({
        id: encodeId('meetingAttendee', a.id),
        ...personView(a),
        attendance: a.attendance,
      })),
      sections: await Promise.all(
        secs.map(async (s) => ({
          id: encodeId('meetingSection', s.id),
          position: s.position,
          title: s.title,
          internalOnly: s.internalOnly,
          liveSource: s.liveSource,
          live: s.liveSource ? await liveSnapshot(scope, m.projectId, s.liveSource) : null,
          items: its.filter((i) => i.sectionId === s.id).map(itemDto),
        })),
      ),
    };
  }

  const meetingDto = (m: MeetingRow, seriesName: string) => ({
    id: encodeId('meeting', m.id),
    projectId: encodeId('project', m.projectId),
    seriesId: encodeId('meetingSeries', m.seriesId),
    seriesName,
    number: m.number,
    title: m.title,
    heldAt: m.heldAt.toISOString(),
    location: m.location,
    chairUserId: userOrNull(m.chairUserId),
    status: m.status,
    correctionsBy: m.correctionsBy,
    issuedVersion: m.issuedVersion,
    version: m.version,
  });

  type Body = Awaited<ReturnType<typeof liveBody>>;

  async function versionList(scope: TenantScope, meetingId: string, withRecipients: boolean) {
    const rows = await scope.tx
      .select({
        version: versions.version,
        issuedAt: versions.issuedAt,
        issuedBy: versions.issuedBy,
        correctionsBy: versions.correctionsBy,
        note: versions.note,
        recipients: versions.recipients,
      })
      .from(versions)
      .where(eq(versions.meetingId, meetingId))
      .orderBy(asc(versions.version));
    return rows.map((r) => ({
      version: r.version,
      issuedAt: r.issuedAt.toISOString(),
      issuedBy: userOrNull(r.issuedBy),
      correctionsBy: r.correctionsBy,
      note: r.note,
      recipients: withRecipients ? r.recipients : [],
    }));
  }

  /** MTG-AC7: what an outsider may see of an issued snapshot. */
  function outsiderBody(body: Body): Body {
    return {
      ...body,
      attendees: body.attendees.map((a) => ({ ...a, email: null })),
      // A live list is a register extract: it never goes outside, whatever its flag says.
      sections: body.sections.filter((s) => !s.internalOnly && !s.live),
    };
  }

  async function detail(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
  ): Promise<MeetingDetail> {
    const v = await viewer(scope, projectId);
    const m = await getMeetingRow(scope, projectId, meetingId);
    const s = await getSeries(scope, projectId, m.seriesId);
    if (v.isInternal) {
      const [body, vers] = await Promise.all([
        liveBody(scope, m, s.name),
        versionList(scope, m.id, true),
      ]);
      const canEdit = await deps.access.can(scope, 'meetings.meetings.write', { projectId });
      const canIssue = await deps.access.can(scope, 'meetings.meetings.issue', { projectId });
      return {
        ...body,
        versions: vers,
        viewer: { audience: 'internal', canEdit, canIssue, viewingVersion: null },
      };
    }
    // An outsider sees the latest issued version, only if they were at the meeting.
    const snap = await latestSnapshot(scope, m.id);
    if (
      !snap ||
      !isParty(
        v,
        snap.body.attendees.map((a) => ({
          userId: decodeId('user', a.userId ?? ''),
          companyId: decodeId('company', a.companyId ?? ''),
        })),
      )
    )
      throw new AppError('meeting.not_found');
    return {
      ...outsiderBody(snap.body),
      versions: await versionList(scope, m.id, false),
      viewer: {
        audience: 'external',
        canEdit: false,
        canIssue: false,
        viewingVersion: snap.version,
      },
    };
  }

  async function latestSnapshot(scope: TenantScope, meetingId: string, version?: number) {
    const [row] = await scope.tx
      .select()
      .from(versions)
      .where(
        and(eq(versions.meetingId, meetingId), ...(version ? [eq(versions.version, version)] : [])),
      )
      .orderBy(desc(versions.version))
      .limit(1);
    return row ? { version: row.version, row, body: row.snapshot as unknown as Body } : null;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    seriesId?: string,
  ): Promise<{ data: MeetingSummary[] }> {
    const v = await viewer(scope, projectId);
    const openActions = sql<number>`(select count(*)::int from meetings.items i
      where i.meeting_id = ${meetings.id} and i.deleted_at is null and i.kind = 'action' and i.status = 'open')`;
    const attended = v.isInternal
      ? sql`true`
      : sql`(${meetings.status} = 'issued' and exists (select 1 from meetings.attendees a where a.meeting_id = ${meetings.id}
          and (a.user_id = ${v.userId}${v.companyId ? sql` or a.company_id = ${v.companyId}` : sql``})))`;
    const rows = await scope.tx
      .select({ m: meetings, seriesName: series.name, openActions })
      .from(meetings)
      .innerJoin(series, eq(meetings.seriesId, series.id))
      .where(
        and(
          eq(meetings.projectId, projectId),
          isNull(meetings.deletedAt),
          ...(seriesId ? [eq(meetings.seriesId, seriesId)] : []),
          attended,
        ),
      )
      .orderBy(desc(meetings.heldAt), desc(meetings.id))
      .limit(500);
    return {
      data: rows.map((r) => ({
        id: encodeId('meeting', r.m.id),
        seriesId: encodeId('meetingSeries', r.m.seriesId),
        seriesName: r.seriesName,
        number: r.m.number,
        title: r.m.title,
        heldAt: r.m.heldAt.toISOString(),
        status: r.m.status,
        issuedVersion: r.m.issuedVersion,
        openActions: v.isInternal ? r.openActions : 0,
      })),
    };
  }

  async function updateMeeting(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
    expected: number,
    patch: UpdateMeetingRequest,
  ) {
    await internalViewer(scope, projectId);
    const m = await getMeetingRow(scope, projectId, meetingId);
    if (m.version !== expected) throw versionConflict();
    if (patch.chairUserId) {
      const id = ref('user', patch.chairUserId, 'chairUserId');
      if (!(await deps.platform.getProjectMembership(scope, projectId, id)))
        throw invalid('chairUserId', 'Not a member of the project');
    }
    const [row] = await scope.tx
      .update(meetings)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.heldAt !== undefined ? { heldAt: new Date(patch.heldAt) } : {}),
        ...(patch.location !== undefined ? { location: patch.location.trim() } : {}),
        ...(patch.chairUserId !== undefined
          ? {
              chairUserId: patch.chairUserId ? ref('user', patch.chairUserId, 'chairUserId') : null,
            }
          : {}),
        ...(patch.correctionsBy !== undefined ? { correctionsBy: patch.correctionsBy } : {}),
        version: m.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(meetings.id, meetingId), eq(meetings.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return detail(scope, projectId, meetingId);
  }

  async function setAttendees(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
    input: { attendees: (MeetingPerson & { attendance?: Attendance })[] },
  ) {
    await internalViewer(scope, projectId);
    await getMeetingRow(scope, projectId, meetingId);
    const list = await people(scope, projectId, input.attendees, 'attendees');
    await scope.tx.delete(attendees).where(eq(attendees.meetingId, meetingId));
    if (list.length)
      await scope.tx.insert(attendees).values(
        list.map((a, i) => ({
          orgId: scope.ctx.orgId,
          projectId,
          id: uuidv7(),
          meetingId,
          position: i + 1,
          ...a,
          attendance: input.attendees[i]!.attendance ?? 'present',
        })),
      );
    return detail(scope, projectId, meetingId);
  }

  async function addSection(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
    input: { title: string; internalOnly?: boolean; liveSource?: LiveSource | null },
  ) {
    await internalViewer(scope, projectId);
    await getMeetingRow(scope, projectId, meetingId);
    const [{ position } = { position: 0 }] = await scope.tx
      .select({ position: sql<number>`coalesce(max(${sections.position}), 0)::int` })
      .from(sections)
      .where(eq(sections.meetingId, meetingId));
    await scope.tx.insert(sections).values({
      orgId: scope.ctx.orgId,
      projectId,
      id: uuidv7(),
      meetingId,
      position: position + 1,
      title: input.title.trim(),
      // A live list is builder-only: it is a register extract, and registers hold more than the room should see.
      internalOnly: input.liveSource ? true : (input.internalOnly ?? false),
      liveSource: input.liveSource ?? null,
    });
    return detail(scope, projectId, meetingId);
  }

  // ----------------------------------------------------------------- items

  async function ownerFields(
    scope: TenantScope,
    projectId: string,
    f: { ownerCompanyId?: string | null; ownerUserId?: string | null; ownerName?: string | null },
  ) {
    const out: Partial<typeof items.$inferInsert> = {};
    if (f.ownerCompanyId !== undefined) {
      if (f.ownerCompanyId) {
        const id = ref('company', f.ownerCompanyId, 'ownerCompanyId');
        const company = (await deps.platform.projectCompanies(scope, projectId)).find(
          (c) => c.id === id,
        );
        if (!company) throw invalid('ownerCompanyId', 'Not a company on the project');
        out.ownerCompanyId = id;
        // The minutes name the owner as written at the time, so the PDF needs no lookups.
        if (f.ownerName === undefined) out.ownerName = company.name;
      } else out.ownerCompanyId = null;
    }
    if (f.ownerUserId !== undefined) {
      if (f.ownerUserId) {
        const id = ref('user', f.ownerUserId, 'ownerUserId');
        if (!(await deps.platform.getProjectMembership(scope, projectId, id)))
          throw invalid('ownerUserId', 'Not a member of the project');
        out.ownerUserId = id;
      } else out.ownerUserId = null;
    }
    if (f.ownerName !== undefined) out.ownerName = f.ownerName?.trim() || null;
    return out;
  }

  function assigned(scope: TenantScope, projectId: string, r: ItemRow) {
    if (r.kind !== 'action' || (!r.ownerCompanyId && !r.ownerUserId)) return;
    scope.events.add({
      type: 'meetings.action.assigned.v1',
      projectId,
      entityType: 'meeting_item',
      entityId: r.id,
      entityVersion: r.version,
      data: {
        itemId: r.id,
        meetingId: r.meetingId,
        ownerCompanyId: r.ownerCompanyId,
        ownerUserId: r.ownerUserId,
        dueDate: r.dueDate,
      },
    });
  }

  async function createItem(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
    input: CreateMeetingItemRequest,
  ) {
    await internalViewer(scope, projectId);
    await getMeetingRow(scope, projectId, meetingId);
    const sectionId = ref('meetingSection', input.sectionId, 'sectionId');
    // The counter moves in the same statement that reads it, so two people adding at once get different numbers.
    const [sec] = await scope.tx
      .update(sections)
      .set({ nextItem: sql`${sections.nextItem} + 1` })
      .where(and(eq(sections.id, sectionId), eq(sections.meetingId, meetingId)))
      .returning();
    if (!sec) throw new AppError('meeting.section_not_found');
    const seq = sec.nextItem - 1;
    const id = uuidv7();
    const status = input.status ?? defaultStatus(input.kind);
    const [row] = await scope.tx
      .insert(items)
      .values({
        orgId: scope.ctx.orgId,
        projectId,
        id,
        meetingId,
        sectionId,
        threadId: id,
        itemNo: itemNumber(sec.position, seq),
        seq,
        kind: input.kind,
        body: input.body.trim(),
        status,
        closedAt: status === 'closed' ? now() : null,
        dueDate: input.dueDate ?? null,
        ...(input.link ? parseLink(input.link, 'link') : {}),
        ...(await ownerFields(scope, projectId, input)),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    assigned(scope, projectId, row!);
    return detail(scope, projectId, meetingId);
  }

  async function updateItem(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    expected: number,
    patch: UpdateMeetingItemRequest,
  ) {
    await internalViewer(scope, projectId);
    const [cur] = await scope.tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.projectId, projectId), isNull(items.deletedAt)))
      .limit(1);
    if (!cur) throw new AppError('meeting.item_not_found');
    if (cur.version !== expected) throw versionConflict();
    const kind = patch.kind ?? cur.kind;
    // Turning a note into an action opens it; turning an action into a note closes it, unless the caller says otherwise.
    const status =
      patch.status ?? (patch.kind && patch.kind !== cur.kind ? defaultStatus(kind) : cur.status);
    const owner = await ownerFields(scope, projectId, patch);
    const [row] = await scope.tx
      .update(items)
      .set({
        kind,
        status,
        ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.link !== undefined
          ? patch.link
            ? parseLink(patch.link, 'link')
            : { linkedType: null, linkedId: null }
          : {}),
        ...owner,
        closedAt: status === 'closed' ? (cur.status === 'closed' ? cur.closedAt : now()) : null,
        version: cur.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(items.id, itemId), eq(items.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    if (
      row.status === 'open' &&
      (cur.ownerCompanyId !== row.ownerCompanyId ||
        cur.ownerUserId !== row.ownerUserId ||
        cur.kind !== row.kind)
    )
      assigned(scope, projectId, row);
    return detail(scope, projectId, row.meetingId);
  }

  async function deleteItem(scope: TenantScope, projectId: string, itemId: string) {
    await internalViewer(scope, projectId);
    const [cur] = await scope.tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.projectId, projectId), isNull(items.deletedAt)))
      .limit(1);
    if (!cur) throw new AppError('meeting.item_not_found');
    if (cur.carriedFromId)
      throw new AppError(
        'meeting.item_carried',
        'This item came from an earlier meeting. Close it instead of removing it.',
      );
    await scope.tx
      .update(items)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(eq(items.id, itemId));
    return detail(scope, projectId, cur.meetingId);
  }

  // ----------------------------------------------------------------- issue

  async function issue(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
    input: IssueMeetingRequest,
  ): Promise<{ detail: MeetingDetail; notice: IssueNotice }> {
    await internalViewer(scope, projectId);
    const m = await getMeetingRow(scope, projectId, meetingId);
    const s = await getSeries(scope, projectId, m.seriesId);
    const body = await liveBody(scope, m, s.name);
    if (!body.attendees.length)
      throw new AppError(
        'meeting.nothing_to_issue',
        'Record who attended before you issue the minutes.',
      );
    // A live list the issuer can't read would freeze as an empty list and read as "nothing due".
    if (body.sections.some((x) => x.live?.restricted))
      throw new AppError(
        'meeting.live_unavailable',
        "You can't see one of the live lists in these minutes, so they can't be issued from your account.",
      );
    const version = m.issuedVersion + 1;
    const correctionsBy = input.correctionsBy === undefined ? m.correctionsBy : input.correctionsBy;
    const seen = new Set<string>();
    const recipients = input.recipients
      .map((r) => ({ name: r.name.trim(), email: r.email.trim().toLowerCase() }))
      .filter((r) => !seen.has(r.email) && seen.add(r.email));
    const snapshot: Body = {
      ...body,
      meeting: { ...body.meeting, status: 'issued', issuedVersion: version, correctionsBy },
    };
    await scope.tx.insert(versions).values({
      orgId: scope.ctx.orgId,
      projectId,
      id: uuidv7(),
      meetingId,
      version,
      issuedAt: now(),
      issuedBy: scope.ctx.userId,
      correctionsBy,
      note: input.note?.trim() || null,
      recipients,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
    await scope.tx
      .update(meetings)
      .set({
        status: 'issued',
        issuedVersion: version,
        correctionsBy,
        version: m.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(eq(meetings.id, meetingId));
    scope.events.add({
      type: 'meetings.minutes.issued.v1',
      projectId,
      entityType: 'meeting',
      entityId: meetingId,
      entityVersion: m.version + 1,
      data: { meetingId, version, recipients: recipients.length },
    });
    const org = await deps.platform.getOrg(scope);
    return {
      detail: await detail(scope, projectId, meetingId),
      notice: {
        orgSlug: org.slug,
        projectId: encodeId('project', projectId),
        meetingId: encodeId('meeting', meetingId),
        title: m.title,
        version,
        correctionsBy,
        note: input.note?.trim() || null,
        recipients,
      },
    };
  }

  /** The snapshot as the minutes document: what the PDF prints and what MTG-AC7 filters. */
  function minutesView(snap: {
    version: number;
    row: typeof versions.$inferSelect;
    body: Body;
  }): MinutesView {
    const b = snap.body;
    return {
      title: b.meeting.title,
      number: b.meeting.number,
      seriesName: b.meeting.seriesName,
      heldAt: b.meeting.heldAt,
      location: b.meeting.location,
      version: snap.version,
      issuedAt: snap.row.issuedAt.toISOString(),
      correctionsBy: snap.row.correctionsBy,
      attendees: b.attendees.map((a) => ({
        name: a.name,
        companyName: a.companyName,
        role: a.role,
        attendance: a.attendance,
      })),
      sections: b.sections.map((s) => ({
        position: s.position,
        title: s.title,
        internalOnly: s.internalOnly,
        live: s.live ?? null,
        items: s.items.map((i) => ({
          itemNo: i.itemNo,
          kind: i.kind,
          body: i.body,
          status: i.status,
          ownerName: i.ownerName,
          dueDate: i.dueDate,
          carriedCount: i.carriedCount,
        })),
      })),
    };
  }

  async function pdf(
    scope: TenantScope,
    projectId: string,
    meetingId: string,
    version: number,
  ): Promise<MeetingPdf> {
    const v = await viewer(scope, projectId);
    const m = await getMeetingRow(scope, projectId, meetingId);
    const snap = await latestSnapshot(scope, meetingId, version);
    if (!snap)
      throw new AppError('meeting.not_issued', 'That version of the minutes has not been issued.');
    if (
      !v.isInternal &&
      !isParty(
        v,
        snap.body.attendees.map((a) => ({
          userId: decodeId('user', a.userId ?? ''),
          companyId: decodeId('company', a.companyId ?? ''),
        })),
      )
    )
      throw new AppError('meeting.not_found');
    const bytes = await renderMinutesPdf(
      forAudience(minutesView(snap), v.isInternal ? 'internal' : 'external'),
    );
    const stem = `${snap.body.meeting.seriesName}-${m.number}-v${version}`.replace(
      /[^A-Za-z0-9._-]+/g,
      '-',
    );
    return {
      filename: `${stem}.pdf`,
      contentType: 'application/pdf',
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  // ------------------------------------------------------------ nova drafting

  /**
   * What Nova needs to turn typed notes into minute items (MTG-US7): the meeting's title, day and agenda sections, and
   * who attended. Only the project team that may write the minutes can ask; `ai` never reads anything else.
   */
  async function forMinutesDraft(scope: TenantScope, projectId: string, meetingId: string) {
    await internalViewer(scope, projectId);
    if (!(await deps.access.can(scope, 'meetings.meetings.write', { projectId })))
      throw new AppError('meeting.not_allowed');
    const m = await getMeetingRow(scope, projectId, meetingId);
    const project = await deps.platform.getProject(scope, projectId);
    const [secs, people] = await Promise.all([
      scope.tx
        .select({ id: sections.id, title: sections.title })
        .from(sections)
        .where(eq(sections.meetingId, m.id))
        .orderBy(asc(sections.position)),
      scope.tx
        .select({ id: attendees.id, name: attendees.name, company: attendees.companyName })
        .from(attendees)
        .where(eq(attendees.meetingId, m.id))
        .orderBy(asc(attendees.position)),
    ]);
    return {
      title: m.title,
      date: localDateOf(m.heldAt, project.timezone),
      sections: secs,
      attendees: people,
    };
  }

  /**
   * Minute items that point at one RFI, defect or variation, newest meeting first, for that record's Related tab
   * (MTG-AC5). Only the project team reads the working minutes; an outsider gets nothing. A carried-forward item
   * appears once, in its latest meeting.
   */
  async function linkedTo(scope: TenantScope, projectId: string, link: MeetingLink) {
    const v = await viewer(scope, projectId);
    if (!v.isInternal) return { data: [] };
    const { linkedType, linkedId } = parseLink(link, 'id');
    const rows = await scope.tx
      .select({ i: items, m: meetings })
      .from(items)
      .innerJoin(meetings, eq(items.meetingId, meetings.id))
      .where(
        and(
          eq(items.projectId, projectId),
          eq(items.linkedType, linkedType),
          eq(items.linkedId, linkedId),
          isNull(items.deletedAt),
          isNull(meetings.deletedAt),
        ),
      )
      .orderBy(desc(meetings.heldAt), desc(items.id))
      .limit(200);
    const seen = new Set<string>();
    const data = [];
    for (const r of rows) {
      if (seen.has(r.i.threadId)) continue;
      seen.add(r.i.threadId);
      data.push({
        meetingId: encodeId('meeting', r.m.id),
        meetingTitle: r.m.title,
        meetingNumber: r.m.number,
        heldAt: r.m.heldAt.toISOString(),
        itemNo: r.i.itemNo,
        kind: r.i.kind,
        body: r.i.body,
        status: r.i.status,
        ownerName: r.i.ownerName,
        dueDate: r.i.dueDate,
      });
      if (data.length >= 50) break;
    }
    return { data };
  }

  // --------------------------------------------------------------- actions

  async function actions(
    scope: TenantScope,
    projectId: string,
    mode: 'mine' | 'all',
  ): Promise<{ data: MeetingAction[] }> {
    const v = await viewer(scope, projectId);
    const project = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    const mine = v.companyId
      ? sql`(${items.ownerUserId} = ${v.userId} or ${items.ownerCompanyId} = ${v.companyId})`
      : sql`${items.ownerUserId} = ${v.userId}`;
    const rows = await scope.tx
      .select({ i: items, m: meetings, seriesName: series.name })
      .from(items)
      .innerJoin(meetings, eq(items.meetingId, meetings.id))
      .innerJoin(series, eq(meetings.seriesId, series.id))
      .innerJoin(sections, eq(items.sectionId, sections.id))
      .where(
        and(
          eq(items.projectId, projectId),
          eq(items.kind, 'action'),
          eq(items.status, 'open'),
          isNull(items.deletedAt),
          isNull(meetings.deletedAt),
          // An open action is carried into every later meeting, so the live copy is the one in the series' latest meeting.
          sql`${meetings.number} = (select max(m2.number) from meetings.meetings m2
                where m2.series_id = ${meetings.seriesId} and m2.deleted_at is null)`,
          ...(v.isInternal && mode === 'all' ? [] : [mine]),
          ...(v.isInternal
            ? []
            : [eq(meetings.status, 'issued'), eq(sections.internalOnly, false)]),
        ),
      )
      .orderBy(sql`${items.dueDate} asc nulls last`, asc(items.id))
      .limit(500);
    return {
      data: rows.map(({ i, m, seriesName }) => ({
        id: encodeId('meetingItem', i.id),
        meetingId: encodeId('meeting', m.id),
        meetingNumber: m.number,
        meetingTitle: m.title,
        seriesName,
        itemNo: i.itemNo,
        body: i.body,
        ownerCompanyId: companyOrNull(i.ownerCompanyId),
        ownerUserId: userOrNull(i.ownerUserId),
        ownerName: i.ownerName,
        dueDate: i.dueDate,
        isOverdue: i.dueDate !== null && i.dueDate < today,
        carriedCount: i.carriedCount,
        stale: isStale(i),
        version: i.version,
      })),
    };
  }

  return {
    listSeries,
    createSeries,
    updateSeries,
    createMeeting,
    list,
    detail,
    updateMeeting,
    setAttendees,
    addSection,
    createItem,
    updateItem,
    deleteItem,
    issue,
    pdf,
    actions,
    forMinutesDraft,
    linkedTo,
  };
}

export type MeetingService = ReturnType<typeof createMeetingService>;
