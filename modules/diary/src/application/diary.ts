import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import { daysBetween, localDateOf, zonedParts, type LocalDate } from '@archova/time';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  COMPANY_SCOPED_KINDS,
  copyLabour,
  defaultEotCandidate,
  diffChanges,
  ID_FIELDS,
  isLateSubmit,
  isLocked,
  labourTotals,
  lateCutoff,
  recordTime,
  type DelayType,
  type DiaryStatus,
  type LineKind,
} from '../domain/diary';
import {
  amendments,
  entries,
  LINE_TABLES,
  type AmendmentTarget,
  type Weather,
} from '../infra/tables';

export type EntryRow = typeof entries.$inferSelect;
export type AmendmentRow = typeof amendments.$inferSelect;
export type LineRow = Record<string, unknown> & {
  id: string;
  projectId: string;
  entryId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export interface Totals {
  labourCompanies: number;
  labourHeadcount: number;
  labourHours: number;
  delayHours: number;
}
export type EntryView = EntryRow & { totals: Totals; lateAfter: Date };

export interface EntryDetail {
  entry: EntryView;
  lines: Record<LineKind, LineRow[]>;
  amendments: AmendmentRow[];
}

/** Longest range one list call returns (about a quarter, enough for an EOT claim period). */
export const MAX_RANGE_DAYS = 93;

export interface DiaryDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'companyExists' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

/** One day as the diary summary (ai F4) reads it: same shape as `DiaryDayForSummary` in `@archova/mod-ai`. */
export interface DiaryDayForSummary {
  entryId: string;
  date: string;
  timeZone: string;
  status: DiaryStatus;
  version: number;
  weather: {
    summary: string | null;
    minC: number | null;
    maxC: number | null;
    rainMm: number | null;
    lostHours: number | null;
  } | null;
  lines: Array<{
    id: string;
    kind: string;
    text: string;
    company: string | null;
    headcount: number | null;
    hours: number | null;
    delayCause: DelayType | null;
    at: string | null;
    photoCaptions: string[];
  }>;
}

export interface HeaderPatch {
  weatherOverride?: Weather | null;
  weatherNotes?: string | null;
  siteConditions?: string | null;
  notes?: string | null;
  fileIds?: string[];
}

/** Line fields in API naming (ids already decoded to UUIDs, times as `HH:mm`). */
export type LineValues = Record<string, unknown>;

interface Viewer {
  /** Set when the caller only sees their own company's lines ("read (own labour)", Sam 02 §4). */
  scopedCompanyId: string | null;
}

const EDITABLE: Record<LineKind, readonly string[]> = {
  labour: ['companyId', 'trade', 'headcount', 'hours', 'notes', 'editReason'],
  plant: ['companyId', 'description', 'quantity', 'hours', 'status'],
  delivery: ['supplierCompanyId', 'supplierName', 'description', 'receivedAt', 'docketNumber'],
  delay: ['type', 'description', 'hours', 'affectedCompanyIds', 'isEotCandidate'],
  visitor: ['name', 'company', 'purpose', 'timeIn', 'timeOut'],
  event: ['kind', 'at', 'description'],
  stand_down: ['startTime', 'endTime', 'affectedCompanyIds', 'reason'],
};

const SYNC_TYPE: Record<LineKind, string> = {
  labour: 'diary_labour',
  plant: 'diary_plant',
  delivery: 'diary_delivery',
  delay: 'diary_delay',
  visitor: 'diary_visitor',
  event: 'diary_event',
  stand_down: 'diary_stand_down',
};

const emptyTotals = (): Totals => ({
  labourCompanies: 0,
  labourHeadcount: 0,
  labourHours: 0,
  delayHours: 0,
});

/** A value as the API shows it, so amendments read the same as the records they describe. */
function publicValue(field: string, value: unknown): unknown {
  const kind = ID_FIELDS[field as keyof typeof ID_FIELDS];
  if (value === null || value === undefined) return value ?? null;
  if (kind)
    return Array.isArray(value)
      ? value.map((v) => encodeId(kind, v))
      : encodeId(kind, value as string);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5);
  return value;
}

function publicChanges(changes: Record<string, [unknown, unknown]>) {
  return Object.fromEntries(
    Object.entries(changes).map(([k, [a, b]]) => [k, [publicValue(k, a), publicValue(k, b)]]),
  ) as Record<string, [unknown, unknown]>;
}

/** Row values comparable with an API patch: times as `HH:mm`, dates as ISO strings. */
function comparable(row: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(
    fields.map((f) => {
      const v = row[f];
      if (typeof v === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(v)) return [f, v.slice(0, 5)];
      if (v instanceof Date) return [f, v.toISOString()];
      return [f, v ?? null];
    }),
  );
}

function normalisePatch(values: LineValues): LineValues {
  const out: LineValues = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = k === 'receivedAt' && typeof v === 'string' ? new Date(v).toISOString() : v;
  }
  return out;
}

function toColumns(values: LineValues): LineValues {
  const out: LineValues = {};
  for (const [k, v] of Object.entries(values))
    out[k] = k === 'receivedAt' && typeof v === 'string' ? new Date(v) : v;
  return out;
}

const localTimeOf = (at: Date, timeZone: string) => {
  const p = zonedParts(at, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

export function createDiaryService(deps: DiaryDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewer(scope: TenantScope, projectId: string): Promise<Viewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    const orgAdmin = perms.orgRole === 'owner' || perms.orgRole === 'admin';
    const scoped = !orgAdmin && perms.companyScopedTools.includes('diary');
    // A scoped reader with no company sees no lines at all.
    return {
      scopedCompanyId: scoped ? (perms.companyId ?? '00000000-0000-0000-0000-000000000000') : null,
    };
  }

  async function projectInfo(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return { timezone: project.timezone, today: localDateOf(now(), project.timezone) };
  }

  async function findEntry(scope: TenantScope, projectId: string, date: LocalDate) {
    const [row] = await scope.tx
      .select()
      .from(entries)
      .where(and(eq(entries.projectId, projectId), eq(entries.date, date)))
      .limit(1);
    return row ?? null;
  }

  async function requireEntry(scope: TenantScope, projectId: string, date: LocalDate) {
    const row = await findEntry(scope, projectId, date);
    if (!row) throw new AppError('diary.not_found', `There is no diary for ${date} yet.`);
    return row;
  }

  /** The day's entry, created as a draft on first write. Only today and earlier days can be written. */
  async function ensureEntry(scope: TenantScope, projectId: string, date: LocalDate) {
    const existing = await findEntry(scope, projectId, date);
    if (existing) return existing;
    const { today } = await projectInfo(scope, projectId);
    if (date > today)
      throw new AppError(
        'diary.future_date',
        "You can't write a diary for a day that hasn't happened yet.",
      );
    await scope.tx
      .insert(entries)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        date,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .onConflictDoNothing({ target: [entries.projectId, entries.date] });
    const row = (await findEntry(scope, projectId, date))!;
    await entryChanged(scope, row);
    return row;
  }

  /** After submit, every change needs a reason (X42). Returns the reason to record, or null on a draft. */
  function amendmentReasonFor(entry: EntryRow, reason: string | undefined): string | null {
    if (!isLocked(entry.status)) return null;
    const r = reason?.trim();
    if (!r)
      throw new AppError(
        'diary.locked',
        'This day has been submitted. Give a reason to amend it.',
        [{ path: 'amendmentReason', message: 'Required after submit' }],
        { status: entry.status },
      );
    return r;
  }

  async function amend(
    scope: TenantScope,
    entry: EntryRow,
    target: { type: AmendmentTarget; id: string },
    action: 'create' | 'update' | 'delete',
    changes: Record<string, [unknown, unknown]>,
    reason: string,
  ) {
    await scope.tx.insert(amendments).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: entry.projectId,
      entryId: entry.id,
      targetType: target.type,
      targetId: target.id,
      action,
      changes: publicChanges(changes),
      reason,
      amendedBy: scope.ctx.userId,
    });
    // An amendment after sign-off needs the PM to confirm the day again.
    const [row] = await scope.tx
      .update(entries)
      .set({
        ...(entry.status === 'signed_off'
          ? { status: 'submitted' as const, signedOffAt: null, signedOffBy: null }
          : {}),
        version: sql`${entries.version} + 1`,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(entries.id, entry.id))
      .returning();
    await entryChanged(scope, row!);
    scope.events.add({
      type: 'diary.entry.amended.v1',
      projectId: entry.projectId,
      entityType: 'diary_entry',
      entityId: entry.id,
      entityVersion: row!.version,
      data: {
        entryId: entry.id,
        date: entry.date,
        targetType: target.type,
        targetId: target.id,
        action,
        fields: Object.keys(changes),
        reason,
        signOffCleared: entry.status === 'signed_off',
      },
    });
  }

  function saved(scope: TenantScope, entry: EntryRow) {
    // Nova re-indexes the day from this (backend 08 §2); one event per write is fine, consumers dedupe.
    scope.events.add({
      type: 'diary.entry.saved.v1',
      projectId: entry.projectId,
      entityType: 'diary_entry',
      entityId: entry.id,
      data: { entryId: entry.id, date: entry.date },
    });
  }

  async function checkCompanies(scope: TenantScope, values: LineValues) {
    for (const field of ['companyId', 'supplierCompanyId'] as const) {
      const id = values[field];
      if (typeof id === 'string' && !(await deps.platform.companyExists(scope, id)))
        throw new AppError('company.not_found', 'Pick a company from the directory.', [
          { path: field, message: 'Unknown company' },
        ]);
    }
    const list = values.affectedCompanyIds;
    if (Array.isArray(list))
      for (const [i, id] of (list as string[]).entries())
        if (!(await deps.platform.companyExists(scope, id)))
          throw new AppError('company.not_found', 'Pick companies from the directory.', [
            { path: `affectedCompanyIds/${i}`, message: 'Unknown company' },
          ]);
  }

  async function checkFiles(scope: TenantScope, projectId: string, fileIds: string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach photos uploaded to this project.', [
          { path: `fileIds/${i}`, message: 'Not a ready file in this project' },
        ]);
    }
  }

  // ---------------------------------------------------------------------------------------------- reads

  async function totalsFor(scope: TenantScope, entryIds: string[], v: Viewer) {
    const out = new Map<string, Totals>();
    if (!entryIds.length) return out;
    const labourWhere: SQL[] = [
      inArray(LINE_TABLES.labour.entryId, entryIds),
      isNull(LINE_TABLES.labour.deletedAt),
    ];
    if (v.scopedCompanyId) labourWhere.push(eq(LINE_TABLES.labour.companyId, v.scopedCompanyId));
    const labour = await scope.tx
      .select({
        entryId: LINE_TABLES.labour.entryId,
        companies: sql<number>`count(distinct ${LINE_TABLES.labour.companyId})::int`,
        headcount: sql<number>`coalesce(sum(${LINE_TABLES.labour.headcount}), 0)::int`,
        hours: sql<number>`coalesce(sum(${LINE_TABLES.labour.hours}), 0)::float8`,
      })
      .from(LINE_TABLES.labour)
      .where(and(...labourWhere))
      .groupBy(LINE_TABLES.labour.entryId);
    for (const l of labour)
      out.set(l.entryId, {
        ...emptyTotals(),
        labourCompanies: l.companies,
        labourHeadcount: l.headcount,
        labourHours: Math.round(l.hours * 100) / 100,
      });
    if (!v.scopedCompanyId) {
      const delays = await scope.tx
        .select({
          entryId: LINE_TABLES.delay.entryId,
          hours: sql<number>`coalesce(sum(${LINE_TABLES.delay.hours}), 0)::float8`,
        })
        .from(LINE_TABLES.delay)
        .where(
          and(inArray(LINE_TABLES.delay.entryId, entryIds), isNull(LINE_TABLES.delay.deletedAt)),
        )
        .groupBy(LINE_TABLES.delay.entryId);
      for (const d of delays) {
        const t = out.get(d.entryId) ?? emptyTotals();
        t.delayHours = Math.round(d.hours * 100) / 100;
        out.set(d.entryId, t);
      }
    }
    return out;
  }

  /** What a company-scoped reader may see of the header: the day, its status and weather, not the notes. */
  function headerFor(row: EntryRow, v: Viewer): EntryRow {
    if (!v.scopedCompanyId) return row;
    return {
      ...row,
      notes: null,
      notesText: '',
      siteConditions: null,
      weatherNotes: null,
      fileIds: [],
    };
  }

  /**
   * For the mobile pull: the records among `ids` the caller can see, as list/detail rows. Entries and lines follow the
   * same company scoping as `list` and `detail`; ids not returned are sent to the device as deletes.
   */
  async function visibleAmong(
    scope: TenantScope,
    projectId: string,
    entityType: string,
    ids: readonly string[],
  ): Promise<{ entries: EntryView[]; lines: Array<{ kind: LineKind; row: LineRow }> }> {
    const v = await viewer(scope, projectId);
    if (entityType === 'diary_entry') {
      const { timezone } = await projectInfo(scope, projectId);
      const where: SQL[] = [eq(entries.projectId, projectId), inArray(entries.id, [...ids])];
      if (v.scopedCompanyId)
        where.push(sql`exists (select 1 from diary.labour l where l.entry_id = ${entries.id}
                       and l.company_id = ${v.scopedCompanyId} and l.deleted_at is null)`);
      const rows = await scope.tx
        .select()
        .from(entries)
        .where(and(...where));
      const totals = await totalsFor(
        scope,
        rows.map((r) => r.id),
        v,
      );
      return {
        entries: rows.map((r) => ({
          ...headerFor(r, v),
          totals: totals.get(r.id) ?? emptyTotals(),
          lateAfter: lateCutoff(r.date, timezone),
        })),
        lines: [],
      };
    }
    const kind = (Object.keys(SYNC_TYPE) as LineKind[]).find((k) => SYNC_TYPE[k] === entityType);
    if (!kind) return { entries: [], lines: [] };
    const t = LINE_TABLES[kind];
    if (v.scopedCompanyId && !COMPANY_SCOPED_KINDS[kind]) return { entries: [], lines: [] };
    const where: SQL[] = [eq(t.projectId, projectId), inArray(t.id, [...ids]), isNull(t.deletedAt)];
    // As with entries, a company's lines are theirs only on days when it has labour (matches `list`).
    if (v.scopedCompanyId)
      where.push(
        sql`company_id = ${v.scopedCompanyId}`,
        sql`exists (select 1 from diary.labour l where l.entry_id = ${t.entryId}
            and l.company_id = ${v.scopedCompanyId} and l.deleted_at is null)`,
      );
    const rows = (await scope.tx
      .select()
      .from(t)
      .where(and(...where))) as LineRow[];
    return { entries: [], lines: rows.map((row) => ({ kind, row })) };
  }

  async function list(scope: TenantScope, projectId: string, from: LocalDate, to: LocalDate) {
    const span = daysBetween(from, to);
    if (span < 0)
      throw new AppError('validation_failed', '`to` must be on or after `from`.', [
        { path: 'to', message: 'Before from' },
      ]);
    if (span + 1 > MAX_RANGE_DAYS)
      throw new AppError(
        'diary.range_too_long',
        `Ask for at most ${MAX_RANGE_DAYS} days at a time.`,
      );
    const { timezone } = await projectInfo(scope, projectId);
    const v = await viewer(scope, projectId);
    const where: SQL[] = [
      eq(entries.projectId, projectId),
      gte(entries.date, from),
      lte(entries.date, to),
    ];
    if (v.scopedCompanyId)
      where.push(sql`exists (select 1 from diary.labour l where l.entry_id = ${entries.id}
                     and l.company_id = ${v.scopedCompanyId} and l.deleted_at is null)`);
    const rows = await scope.tx
      .select()
      .from(entries)
      .where(and(...where))
      .orderBy(sql`${entries.date} desc`);
    const totals = await totalsFor(
      scope,
      rows.map((r) => r.id),
      v,
    );
    return rows.map((r): EntryView => ({
      ...headerFor(r, v),
      totals: totals.get(r.id) ?? emptyTotals(),
      lateAfter: lateCutoff(r.date, timezone),
    }));
  }

  async function detail(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
  ): Promise<EntryDetail> {
    const entry = await requireEntry(scope, projectId, date);
    const { timezone } = await projectInfo(scope, projectId);
    const v = await viewer(scope, projectId);
    const lines = {} as Record<LineKind, LineRow[]>;
    for (const kind of Object.keys(LINE_TABLES) as LineKind[]) {
      const t = LINE_TABLES[kind];
      const scopeCol = COMPANY_SCOPED_KINDS[kind];
      if (v.scopedCompanyId && !scopeCol) {
        lines[kind] = [];
        continue;
      }
      const where: SQL[] = [eq(t.entryId, entry.id), isNull(t.deletedAt)];
      if (v.scopedCompanyId) where.push(sql`company_id = ${v.scopedCompanyId}`);
      lines[kind] = (await scope.tx
        .select()
        .from(t)
        .where(and(...where))
        .orderBy(asc(t.createdAt), asc(t.id))) as LineRow[];
    }
    let amends = await scope.tx
      .select()
      .from(amendments)
      .where(eq(amendments.entryId, entry.id))
      .orderBy(asc(amendments.amendedAt), asc(amendments.id));
    if (v.scopedCompanyId) {
      const own = new Set<string>();
      for (const kind of ['labour', 'plant'] as const) {
        const t = LINE_TABLES[kind];
        const ids = await scope.tx
          .select({ id: t.id })
          .from(t)
          .where(and(eq(t.entryId, entry.id), eq(t.companyId, v.scopedCompanyId)));
        ids.forEach((r) => own.add(r.id));
      }
      amends = amends.filter((a) => own.has(a.targetId));
    }
    const totals = labourTotals(
      lines.labour as unknown as Array<{
        companyId: string;
        headcount: number | null;
        hours: number | null;
      }>,
    );
    const delayHours = (lines.delay as unknown as Array<{ hours: number }>).reduce(
      (n, d) => n + d.hours,
      0,
    );
    return {
      entry: {
        ...headerFor(entry, v),
        totals: {
          labourCompanies: totals.companies,
          labourHeadcount: totals.headcount,
          labourHours: totals.hours,
          delayHours: Math.round(delayHours * 100) / 100,
        },
        lateAfter: lateCutoff(entry.date, timezone),
      },
      lines,
      amendments: amends,
    };
  }

  /**
   * The day's lines for the diary summary, with internal ids. Null when there is no entry or the caller can't
   * read the diary; a company-scoped reader gets only their own lines, as in `detail`. Photos carry no captions.
   */
  async function dayForSummary(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
  ): Promise<DiaryDayForSummary | null> {
    if (!(await deps.access.can(scope, 'diary.entries.read', { projectId }))) return null;
    if (!(await findEntry(scope, projectId, date))) return null;
    const { entry, lines } = await detail(scope, projectId, date);
    const { timezone } = await projectInfo(scope, projectId);
    const names = new Map(
      (await deps.platform.projectCompanies(scope, projectId)).map((c) => [c.id, c.name]),
    );
    const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
    const company = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);
    const join = (...parts: Array<string | null | undefined>) =>
      parts.filter((x) => x && x.trim()).join(' - ');
    const out: DiaryDayForSummary['lines'] = [];
    const add = (
      kind: string,
      row: { id: string },
      f: Partial<DiaryDayForSummary['lines'][number]> & { text: string },
    ) =>
      out.push({
        id: row.id,
        kind,
        company: null,
        headcount: null,
        hours: null,
        delayCause: null,
        at: null,
        photoCaptions: [],
        ...f,
      });
    for (const r of lines.labour as Array<typeof LINE_TABLES.labour.$inferSelect>)
      add('labour', r, {
        text: join(r.trade, r.notes) || 'Labour',
        company: company(r.companyId),
        headcount: r.headcount,
        hours: r.hours,
      });
    for (const r of lines.plant as Array<typeof LINE_TABLES.plant.$inferSelect>)
      add('plant', r, {
        text: join(r.description, `x${r.quantity}`, r.status === 'working' ? null : r.status),
        company: company(r.companyId),
        hours: r.hours,
      });
    for (const r of lines.delivery as Array<typeof LINE_TABLES.delivery.$inferSelect>)
      add('delivery', r, {
        text: join(r.description, r.docketNumber ? `docket ${r.docketNumber}` : null),
        company: r.supplierName ?? company(r.supplierCompanyId),
        at: r.receivedAt ? localTimeOf(r.receivedAt, timezone) : null,
      });
    for (const r of lines.visitor as Array<typeof LINE_TABLES.visitor.$inferSelect>)
      add('visitor', r, {
        text: join(r.name, r.purpose),
        company: r.company,
        at: hhmm(r.timeIn),
      });
    for (const r of lines.delay as Array<typeof LINE_TABLES.delay.$inferSelect>)
      add('delay', r, { text: r.description, hours: r.hours, delayCause: r.type });
    for (const r of lines.stand_down as Array<typeof LINE_TABLES.stand_down.$inferSelect>)
      add('stand_down', r, { text: r.reason ?? 'Stand down', at: hhmm(r.startTime) });
    for (const r of lines.event as Array<typeof LINE_TABLES.event.$inferSelect>)
      add(r.kind, r, { text: r.description, at: hhmm(r.at) });
    const raw = entry.weatherOverride ?? entry.weather;
    const c = raw?.conditions;
    const summary = join(c?.am, c?.midday, c?.pm, entry.weatherNotes) || null;
    const lostHours = (lines.delay as unknown as Array<{ type: DelayType; hours: number }>)
      .filter((d) => d.type === 'weather')
      .reduce((n, d) => n + d.hours, 0);
    return {
      entryId: entry.id,
      date: entry.date,
      timeZone: timezone,
      status: entry.status,
      version: entry.version,
      weather:
        raw || summary || lostHours
          ? {
              summary,
              minC: raw?.minTempC ?? null,
              maxC: raw?.maxTempC ?? null,
              rainMm: raw?.rainfallMm ?? null,
              lostHours: lostHours ? Math.round(lostHours * 100) / 100 : null,
            }
          : null,
      lines: out,
    };
  }

  // --------------------------------------------------------------------------------------------- header

  async function saveHeader(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    expectedVersion: number | null,
    patch: HeaderPatch,
    reason?: string,
  ) {
    const existing = await findEntry(scope, projectId, date);
    if (existing && expectedVersion === null)
      throw new AppError(
        'precondition_required',
        'If-Match header is required once the day exists.',
      );
    const entry = existing ?? (await ensureEntry(scope, projectId, date));
    if (existing && entry.version !== expectedVersion) throw versionConflict();
    const amendmentReason = amendmentReasonFor(entry, reason);
    if (patch.fileIds) await checkFiles(scope, projectId, patch.fileIds);
    const before = {
      weatherOverride: entry.weatherOverride,
      weatherNotes: entry.weatherNotes,
      siteConditions: entry.siteConditions,
      notes: entry.notesText || null,
      fileIds: entry.fileIds,
    };
    const changes = diffChanges(before, {
      ...patch,
      ...(patch.fileIds ? { fileIds: [...new Set(patch.fileIds)] } : {}),
    });
    if (!Object.keys(changes).length) return detail(scope, projectId, date);
    const values: Partial<typeof entries.$inferInsert> = {};
    if (patch.weatherOverride !== undefined) values.weatherOverride = patch.weatherOverride;
    if (patch.weatherNotes !== undefined) values.weatherNotes = patch.weatherNotes;
    if (patch.siteConditions !== undefined) values.siteConditions = patch.siteConditions;
    if (patch.notes !== undefined) {
      values.notesText = patch.notes ?? '';
      values.notes = patch.notes === null ? null : { type: 'text', text: patch.notes };
    }
    if (patch.fileIds !== undefined) values.fileIds = [...new Set(patch.fileIds)];
    const [row] = await scope.tx
      .update(entries)
      .set({ ...values, version: entry.version + 1, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(and(eq(entries.id, entry.id), eq(entries.version, entry.version)))
      .returning();
    if (!row) throw versionConflict();
    await entryChanged(scope, row);
    if (amendmentReason)
      await amend(scope, row, { type: 'entry', id: row.id }, 'update', changes, amendmentReason);
    saved(scope, row);
    return detail(scope, projectId, date);
  }

  async function submit(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    expectedVersion: number,
    clientAt?: Date,
  ) {
    const entry = await requireEntry(scope, projectId, date);
    if (entry.status !== 'draft')
      throw new AppError('diary.already_submitted', 'This day has already been submitted.');
    if (entry.version !== expectedVersion) throw versionConflict();
    const { timezone } = await projectInfo(scope, projectId);
    const receivedAt = now();
    const submittedAt = recordTime(clientAt, receivedAt);
    const isLate = isLateSubmit(submittedAt, entry.date, timezone);
    const [row] = await scope.tx
      .update(entries)
      .set({
        status: 'submitted',
        submittedAt,
        submitReceivedAt: receivedAt,
        submittedBy: scope.ctx.userId,
        isLate,
        version: entry.version + 1,
        updatedAt: receivedAt,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(entries.id, entry.id), eq(entries.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await entryChanged(scope, row);
    scope.events.add({
      type: 'diary.entry.submitted.v1',
      projectId,
      entityType: 'diary_entry',
      entityId: row.id,
      entityVersion: row.version,
      data: { entryId: row.id, date: row.date, isLate, submittedAt: submittedAt.toISOString() },
    });
    saved(scope, row);
    return detail(scope, projectId, date);
  }

  async function signOff(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    expectedVersion: number,
  ) {
    const entry = await requireEntry(scope, projectId, date);
    if (entry.status === 'draft')
      throw new AppError('diary.not_submitted', 'Submit the day before signing it off.');
    if (entry.version !== expectedVersion) throw versionConflict();
    if (entry.status === 'signed_off') return detail(scope, projectId, date);
    const [row] = await scope.tx
      .update(entries)
      .set({
        status: 'signed_off',
        signedOffAt: now(),
        signedOffBy: scope.ctx.userId,
        version: entry.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(entries.id, entry.id), eq(entries.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await entryChanged(scope, row);
    scope.events.add({
      type: 'diary.entry.signed_off.v1',
      projectId,
      entityType: 'diary_entry',
      entityId: row.id,
      entityVersion: row.version,
      data: { entryId: row.id, date: row.date },
    });
    return detail(scope, projectId, date);
  }

  async function copyLabourFrom(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    fromDate: LocalDate,
  ) {
    const source = await requireEntry(scope, projectId, fromDate);
    const entry = await ensureEntry(scope, projectId, date);
    if (isLocked(entry.status))
      throw new AppError(
        'diary.locked',
        'This day has been submitted; add labour lines one by one with a reason.',
      );
    const t = LINE_TABLES.labour;
    const [from, existing] = await Promise.all([
      scope.tx
        .select()
        .from(t)
        .where(and(eq(t.entryId, source.id), isNull(t.deletedAt)))
        .orderBy(asc(t.createdAt), asc(t.id)),
      scope.tx
        .select()
        .from(t)
        .where(and(eq(t.entryId, entry.id), isNull(t.deletedAt))),
    ]);
    const have = new Set(existing.map((l) => `${l.companyId}|${l.trade ?? ''}`));
    const add = copyLabour(from).filter((l) => !have.has(`${l.companyId}|${l.trade ?? ''}`));
    if (add.length) {
      const rows = await scope.tx
        .insert(t)
        .values(
          add.map((l) => ({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            entryId: entry.id,
            companyId: l.companyId,
            trade: l.trade,
            createdBy: scope.ctx.userId,
            updatedBy: scope.ctx.userId,
          })),
        )
        .returning();
      for (const r of rows) await lineChanged(scope, 'labour', r as LineRow, 'upsert');
      saved(scope, entry);
    }
    return detail(scope, projectId, date);
  }

  // ---------------------------------------------------------------------------------------------- lines

  function pick(kind: LineKind, values: LineValues): LineValues {
    const out: LineValues = {};
    for (const f of EDITABLE[kind]) if (values[f] !== undefined) out[f] = values[f];
    return out;
  }

  async function findLine(scope: TenantScope, kind: LineKind, entry: EntryRow, lineId: string) {
    const t = LINE_TABLES[kind];
    const [row] = await scope.tx
      .select()
      .from(t)
      .where(and(eq(t.id, lineId), eq(t.entryId, entry.id), isNull(t.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('diary_line.not_found');
    return row as LineRow;
  }

  async function createLine(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    kind: LineKind,
    input: LineValues,
    reason?: string,
  ) {
    const entry = await ensureEntry(scope, projectId, date);
    const amendmentReason = amendmentReasonFor(entry, reason);
    const values = pick(kind, input);
    if (kind === 'delay' && values.isEotCandidate === undefined)
      values.isEotCandidate = defaultEotCandidate(values.type as DelayType);
    if (kind === 'labour') delete values.editReason;
    await checkCompanies(scope, values);
    const t = LINE_TABLES[kind];
    const id = uuidv7();
    const [row] = (await scope.tx
      .insert(t)
      .values({
        ...toColumns(values),
        id,
        orgId: scope.ctx.orgId,
        projectId,
        entryId: entry.id,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      } as never)
      .returning()) as LineRow[];
    await lineChanged(scope, kind, row!, 'upsert');
    if (amendmentReason)
      await amend(
        scope,
        entry,
        { type: kind, id },
        'create',
        diffChanges({}, normalisePatch(values)),
        amendmentReason,
      );
    saved(scope, entry);
    return row!;
  }

  async function updateLine(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    kind: LineKind,
    lineId: string,
    expectedVersion: number,
    input: LineValues,
    reason?: string,
  ) {
    const entry = await requireEntry(scope, projectId, date);
    const line = await findLine(scope, kind, entry, lineId);
    const amendmentReason = amendmentReasonFor(entry, reason);
    if (line.version !== expectedVersion) throw versionConflict();
    const values = pick(kind, input);
    const fields = EDITABLE[kind].filter((f) => f !== 'editReason');
    const changes = diffChanges(comparable(line, fields), normalisePatch(values));
    delete changes.editReason;
    // Pre-filled attendance numbers can be corrected, but only with a reason (ATT-AC6).
    if (
      kind === 'labour' &&
      line.source === 'attendance' &&
      ('headcount' in changes || 'hours' in changes) &&
      !(typeof values.editReason === 'string' && values.editReason.trim())
    )
      throw new AppError(
        'diary.edit_reason_required',
        'Say why the site attendance numbers are wrong.',
        [{ path: 'editReason', message: 'Required to change attendance numbers' }],
      );
    if (!Object.keys(changes).length) return line;
    await checkCompanies(scope, values);
    const t = LINE_TABLES[kind];
    const [row] = (await scope.tx
      .update(t)
      .set({
        ...toColumns(values),
        version: line.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      } as never)
      .where(and(eq(t.id, lineId), eq(t.version, expectedVersion)))
      .returning()) as LineRow[];
    if (!row) throw versionConflict();
    await lineChanged(scope, kind, row, 'upsert');
    if (amendmentReason)
      await amend(scope, entry, { type: kind, id: lineId }, 'update', changes, amendmentReason);
    saved(scope, entry);
    return row;
  }

  /** Removes a line. Lines are soft-deleted so a removal after submit stays in the record (X42). */
  async function deleteLine(
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    kind: LineKind,
    lineId: string,
    reason?: string,
  ) {
    const entry = await requireEntry(scope, projectId, date);
    const line = await findLine(scope, kind, entry, lineId);
    const amendmentReason = amendmentReasonFor(entry, reason);
    const t = LINE_TABLES[kind];
    const [row] = (await scope.tx
      .update(t)
      .set({ deletedAt: now(), version: line.version + 1, updatedBy: scope.ctx.userId } as never)
      .where(eq(t.id, lineId))
      .returning()) as LineRow[];
    await lineChanged(scope, kind, row!, 'delete');
    if (amendmentReason) {
      const fields = EDITABLE[kind].filter((f) => f !== 'editReason');
      const snapshot = comparable(line, fields);
      const changes = Object.fromEntries(
        Object.entries(snapshot)
          .filter(([, v]) => v !== null)
          .map(([k, v]) => [k, [v, null] as [unknown, unknown]]),
      );
      await amend(scope, entry, { type: kind, id: lineId }, 'delete', changes, amendmentReason);
    }
    saved(scope, entry);
  }

  /**
   * Subscriber for `workforce.attendance.session_closed.v1` (ATT-AC6): keeps one `attendance` labour line
   * per company per day in step with sign-ins. The pre-filled values are always refreshed; the line's own
   * headcount and hours follow them until the site manager edits the line (an edit carries `editReason`).
   * A deleted attendance line is not re-created. A submitted day isn't changed without a reason, so only the pre-filled values move there, and no new
   * line is added to it.
   */
  async function applyAttendanceTotals(
    scope: TenantScope,
    input: {
      projectId: string;
      localDate: LocalDate;
      companyId: string;
      headcount: number;
      hours: number;
    },
  ) {
    const t = LINE_TABLES.labour;
    let entry = await findEntry(scope, input.projectId, input.localDate);
    if (!entry) {
      await scope.tx
        .insert(entries)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId: input.projectId,
          date: input.localDate,
        })
        .onConflictDoNothing({ target: [entries.projectId, entries.date] });
      entry = (await findEntry(scope, input.projectId, input.localDate))!;
      await entryChanged(scope, entry);
    }
    const [line] = await scope.tx
      .select()
      .from(t)
      .where(
        and(eq(t.entryId, entry.id), eq(t.companyId, input.companyId), eq(t.source, 'attendance')),
      )
      .orderBy(desc(t.id))
      .limit(1);
    // A line the site manager removed stays removed; it isn't re-created at the next sign-out.
    if (line?.deletedAt) return null;
    if (!line) {
      if (isLocked(entry.status)) return null;
      const [row] = await scope.tx
        .insert(t)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId: input.projectId,
          entryId: entry.id,
          companyId: input.companyId,
          source: 'attendance',
          headcount: input.headcount,
          hours: input.hours,
          attendanceHeadcount: input.headcount,
          attendanceHours: input.hours,
        })
        .returning();
      await lineChanged(scope, 'labour', row as LineRow, 'upsert');
      return row!;
    }
    const followsAttendance = !line.editReason && !isLocked(entry.status);
    const [row] = await scope.tx
      .update(t)
      .set({
        attendanceHeadcount: input.headcount,
        attendanceHours: input.hours,
        ...(followsAttendance ? { headcount: input.headcount, hours: input.hours } : {}),
        version: line.version + 1,
        updatedAt: now(),
      })
      .where(eq(t.id, line.id))
      .returning();
    await lineChanged(scope, 'labour', row as LineRow, 'upsert');
    return row!;
  }

  return {
    list,
    detail,
    applyAttendanceTotals,
    visibleAmong,
    dayForSummary,
    saveHeader,
    submit,
    signOff,
    copyLabourFrom,
    createLine,
    updateLine,
    deleteLine,
  };
}

async function entryChanged(scope: TenantScope, r: EntryRow) {
  await scope.recordChange({
    module: 'diary',
    entityType: 'diary_entry',
    entityId: r.id,
    op: 'upsert',
    version: r.version,
    projectId: r.projectId,
  });
}

async function lineChanged(
  scope: TenantScope,
  kind: LineKind,
  r: LineRow,
  op: 'upsert' | 'delete',
) {
  const company = COMPANY_SCOPED_KINDS[kind] ? ((r.companyId as string | null) ?? null) : null;
  await scope.recordChange({
    module: 'diary',
    entityType: SYNC_TYPE[kind],
    entityId: r.id,
    op,
    version: r.version,
    projectId: r.projectId,
    ...(company ? { scopeCompanyId: company } : {}),
  });
}

export type DiaryService = ReturnType<typeof createDiaryService>;
