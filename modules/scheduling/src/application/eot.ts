import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { CorrespondenceModule } from '@archova/mod-correspondence';
import type { DiaryApi } from '@archova/mod-diary';
import type { PlatformApi } from '@archova/mod-platform';
import type { RfisApi } from '@archova/mod-rfis';
import { addDays, localDateOf, type LocalDate } from '@archova/time';
import {
  ACTION_FROM,
  DEFAULT_SETTINGS,
  LIVE_STATUSES,
  canDo,
  clocks,
  computeFlags,
  draftEotLetter,
  eventRef,
  isRainDay,
  spanDays,
  summariseEvidence,
  weatherText,
  type DayBasis,
  type DelayCause,
  type Draft,
  type EotForm,
  type EotSettings,
  type EvidenceItem,
  type EventAction,
  type EventStatus,
  type ItemKind,
} from '../domain/eot';
import { diaryRow, rfiRows, type DelayCause as RegisterCause } from '../domain/register';
import { delayEventItems, delayEventLog, delayEvents, eotSettings } from '../infra/tables';

export type EventRow = typeof delayEvents.$inferSelect;
export type ItemRow = typeof delayEventItems.$inferSelect;
export type LogRow = typeof delayEventLog.$inferSelect;
export type SettingsRow = typeof eotSettings.$inferSelect;

export interface EotDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  diary: Pick<DiaryApi, 'delayLines' | 'weatherDays'>;
  rfis: Pick<RfisApi, 'timeImpacts'>;
  correspondence: Pick<CorrespondenceModule['api'], 'linkSummaries'>;
  now?: () => Date;
}

/** How far back the register looks for delays and rain days to attach. About a contract's notice and claim periods, with room. */
export const LOOKBACK_DAYS = 365;
const SOURCE_LIMIT = 500;

export interface SettingsView extends EotSettings {
  /** True until a person saves the settings: the values are the AS 4000 defaults. */
  isDefault: boolean;
  confirmedAt: Date | null;
  version: number;
}

export interface Candidate {
  key: string;
  kind: Extract<ItemKind, 'diary_delay' | 'rfi_impact' | 'rfi_late' | 'weather_day'>;
  cause: DelayCause;
  date: LocalDate;
  label: string;
  detail: string | null;
  hours: number | null;
  days: number | null;
  rainMm: number | null;
  possibleEot: boolean;
  /** Set when the evidence is already in an event. */
  eventId: string | null;
}

export interface EventView extends EventRow {
  evidence: ReturnType<typeof summariseEvidence>;
  clocks: ReturnType<typeof clocks>;
  suggestedDays: number;
}

export interface EventInput {
  title: string;
  cause: DelayCause;
  startedOn: LocalDate;
  endedOn?: LocalDate | null | undefined;
  awareOn?: LocalDate | undefined;
  criticalPath?: boolean | null | undefined;
  summary?: string | null | undefined;
  affected?: string | null | undefined;
  daysClaimed?: number | undefined;
  noticeDueOn?: LocalDate | null | undefined;
  claimDueOn?: LocalDate | null | undefined;
  candidateKeys?: readonly string[] | undefined;
}
export type EventPatch = Partial<Omit<EventInput, 'candidateKeys'>>;

export interface EvidenceInput {
  candidateKeys?: readonly string[] | undefined;
  correspondenceIds?: readonly string[] | undefined;
  notes?:
    | readonly { date?: LocalDate | undefined; label: string; detail?: string | undefined }[]
    | undefined;
}

export interface TransitionInput {
  action: EventAction;
  on?: LocalDate | undefined;
  daysClaimed?: number | undefined;
  daysGranted?: number | undefined;
  note?: string | undefined;
  correspondenceId?: string | undefined;
}

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);
const text = (v: string | null | undefined) => v?.trim() || null;
const num = (v: number | null) => (v === null ? null : Number(v));

const toSettings = (r: SettingsRow): SettingsView => ({
  form: r.form,
  noticeDays: r.noticeDays,
  claimDays: r.claimDays,
  dayBasis: r.dayBasis,
  noticeClause: r.noticeClause,
  claimClause: r.claimClause,
  confirmed: r.confirmed,
  rainThresholdMm: Number(r.rainThresholdMm),
  wetDayAllowance: r.wetDayAllowance,
  isDefault: false,
  confirmedAt: r.confirmedAt,
  version: r.version,
});

const toEvidence = (i: ItemRow): EvidenceItem => ({
  id: i.id,
  kind: i.kind,
  onDate: i.onDate,
  label: i.label,
  detail: i.detail,
  hours: num(i.hours),
  days: num(i.days),
  rainMm: num(i.rainMm),
});

/**
 * Delay events and EOT claims (product/08 SCH-AC3..5): delays from the diary, RFIs and weather grouped into an event
 * with an evidence pack, the notice and claim clocks from the contract's periods, and a draft notice or claim for a
 * person to edit and send. Nothing here sends anything, and Nova's draft never says an extension is due.
 */
export function createEotService(deps: EotDeps) {
  const now = deps.now ?? (() => new Date());

  /** Builder staff only: the delay register and its evidence are not for readers limited to their own company. */
  async function staff(scope: TenantScope, projectId: string) {
    const rows = await deps.diary.delayLines(scope, projectId, { limit: 0 });
    if (rows === null) throw new AppError('access.denied');
  }

  async function context(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return { project, today: localDateOf(now(), project.timezone) };
  }

  // ---- settings ---------------------------------------------------------------------------------------------

  async function settingsRow(scope: TenantScope, projectId: string, lock = false) {
    const q = scope.tx
      .select()
      .from(eotSettings)
      .where(eq(eotSettings.projectId, projectId))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    return r ?? null;
  }

  async function getSettings(scope: TenantScope, projectId: string): Promise<SettingsView> {
    await staff(scope, projectId);
    const r = await settingsRow(scope, projectId);
    return r
      ? toSettings(r)
      : { ...DEFAULT_SETTINGS, isDefault: true, confirmedAt: null, version: 0 };
  }

  async function putSettings(
    scope: TenantScope,
    projectId: string,
    input: {
      form: EotForm;
      noticeDays: number;
      claimDays: number;
      dayBasis: DayBasis;
      noticeClause?: string | null | undefined;
      claimClause?: string | null | undefined;
      confirmed: boolean;
      rainThresholdMm: number;
      wetDayAllowance?: number | null | undefined;
    },
  ): Promise<SettingsView> {
    await staff(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const cur = await settingsRow(scope, projectId, true);
    const values = {
      form: input.form,
      noticeDays: input.noticeDays,
      claimDays: input.claimDays,
      dayBasis: input.dayBasis,
      noticeClause: text(input.noticeClause),
      claimClause: text(input.claimClause),
      confirmed: input.confirmed,
      confirmedBy: input.confirmed ? (cur?.confirmed ? cur.confirmedBy : scope.ctx.userId) : null,
      confirmedAt: input.confirmed ? (cur?.confirmed ? cur.confirmedAt : now()) : null,
      rainThresholdMm: input.rainThresholdMm,
      wetDayAllowance: input.wetDayAllowance ?? null,
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
    };
    if (cur) {
      const [r] = await scope.tx
        .update(eotSettings)
        .set({ ...values, version: cur.version + 1 })
        .where(eq(eotSettings.id, cur.id))
        .returning();
      return toSettings(r!);
    }
    const [r] = await scope.tx
      .insert(eotSettings)
      .values({ id: uuidv7(), orgId: scope.ctx.orgId, projectId, ...values })
      .returning();
    return toSettings(r!);
  }

  // ---- candidates (what could go into an event) --------------------------------------------------------------

  async function attachedKeys(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({ key: delayEventItems.sourceKey, eventId: delayEventItems.eventId })
      .from(delayEventItems)
      .where(and(eq(delayEventItems.projectId, projectId), isNotNull(delayEventItems.sourceKey)))
      .limit(5000);
    return new Map(rows.map((r) => [r.key!, r.eventId]));
  }

  async function buildCandidates(
    scope: TenantScope,
    projectId: string,
    window: { from: LocalDate; to: LocalDate },
    settings: EotSettings,
    tz: string,
    today: LocalDate,
  ) {
    const attached = await attachedKeys(scope, projectId);
    const out: Candidate[] = [];
    let truncated = false;
    const lines = await deps.diary.delayLines(scope, projectId, {
      from: window.from,
      to: window.to,
      limit: SOURCE_LIMIT,
    });
    for (const l of (lines ?? []).slice(0, SOURCE_LIMIT)) {
      const pub = encodeId('diaryDelay', l.id);
      const r = diaryRow({ ...l, type: l.type as RegisterCause, hours: Number(l.hours) }, pub);
      const key = `diary:${pub}`;
      out.push({
        key,
        kind: 'diary_delay',
        cause: r.cause,
        date: r.date,
        label: r.title,
        detail: null,
        hours: r.hours,
        days: null,
        rainMm: null,
        possibleEot: r.possibleEot,
        eventId: attached.get(key) ?? null,
      });
    }
    if (lines && lines.length > SOURCE_LIMIT) truncated = true;

    const impacts = await deps.rfis.timeImpacts(scope, projectId, { limit: SOURCE_LIMIT });
    if (impacts.truncated) truncated = true;
    for (const rfi of impacts.rows) {
      for (const r of rfiRows(rfi, encodeId('rfi', rfi.id), impacts.today, impacts.timeZone)) {
        if (r.date < window.from || r.date > window.to) continue;
        const key = r.id;
        out.push({
          key,
          kind: r.kind === 'rfi_late_answer' ? 'rfi_late' : 'rfi_impact',
          cause: 'design',
          date: r.date,
          label: r.title,
          detail:
            r.kind === 'rfi_late_answer'
              ? 'Answered after its due date'
              : 'Schedule impact recorded on the RFI',
          hours: null,
          days: r.days,
          rainMm: null,
          possibleEot: true,
          eventId: attached.get(key) ?? null,
        });
      }
    }

    const wx = await deps.diary.weatherDays(scope, projectId, {
      from: window.from,
      to: window.to,
      limit: SOURCE_LIMIT,
    });
    if (wx && wx.length > SOURCE_LIMIT) truncated = true;
    for (const d of (wx ?? []).slice(0, SOURCE_LIMIT)) {
      if (!isRainDay(d.rainfallMm, d.weatherDelayHours, settings.rainThresholdMm)) continue;
      const key = `weather:${d.date}`;
      const reading = {
        rainfallMm: d.rainfallMm,
        minTempC: d.minTempC,
        maxTempC: d.maxTempC,
        windKmh: d.windKmh,
        conditions: d.conditions,
      };
      out.push({
        key,
        kind: 'weather_day',
        cause: 'weather',
        date: d.date,
        label: `Rain day: ${weatherText(reading)}`,
        detail: [
          d.corrected ? 'Weather corrected by the site manager' : 'Site diary weather',
          d.stationId ? `station ${d.stationId}` : null,
          d.weatherDelayHours > 0 ? `${d.weatherDelayHours} h weather delay logged` : null,
          d.standDowns > 0 ? `${d.standDowns} stand-down${d.standDowns === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(', '),
        hours: d.weatherDelayHours > 0 ? d.weatherDelayHours : null,
        days: null,
        rainMm: d.rainfallMm,
        // A rain day is evidence, not a delay: the weather delay line the site logged on it is what may be an EOT,
        // so it is not counted a second time here.
        possibleEot: false,
        eventId: attached.get(key) ?? null,
      });
    }
    out.sort((a, b) => (a.date === b.date ? (a.key < b.key ? 1 : -1) : a.date < b.date ? 1 : -1));
    void tz;
    void today;
    return { data: out, truncated };
  }

  async function candidates(
    scope: TenantScope,
    projectId: string,
    opts: {
      from?: LocalDate | undefined;
      to?: LocalDate | undefined;
      includeAttached?: boolean | undefined;
    },
  ) {
    await staff(scope, projectId);
    const { project, today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const from = opts.from ?? addDays(today, -120);
    const to = opts.to ?? today;
    const r = await buildCandidates(
      scope,
      projectId,
      { from, to },
      settings,
      project.timezone,
      today,
    );
    return {
      today,
      rainThresholdMm: settings.rainThresholdMm,
      truncated: r.truncated,
      data: opts.includeAttached ? r.data : r.data.filter((c) => c.eventId === null),
    };
  }

  // ---- events -----------------------------------------------------------------------------------------------

  async function row(scope: TenantScope, projectId: string, id: string, lock = false) {
    const q = scope.tx
      .select()
      .from(delayEvents)
      .where(and(eq(delayEvents.id, id), eq(delayEvents.projectId, projectId)))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('delay_event.not_found');
    return r;
  }

  const itemsOf = (scope: TenantScope, eventIds: string[]) =>
    eventIds.length === 0
      ? Promise.resolve([] as ItemRow[])
      : scope.tx
          .select()
          .from(delayEventItems)
          .where(inArray(delayEventItems.eventId, eventIds))
          .orderBy(asc(delayEventItems.onDate), asc(delayEventItems.id))
          .limit(5000);

  const view = (e: EventRow, items: ItemRow[], s: EotSettings, today: LocalDate): EventView => ({
    ...e,
    evidence: summariseEvidence(items.map(toEvidence)),
    clocks: clocks(e, s, today),
    suggestedDays: spanDays(e.startedOn, e.endedOn, today),
  });

  async function log(
    scope: TenantScope,
    e: { id: string; projectId: string },
    kind: string,
    detail?: string,
  ) {
    await scope.tx.insert(delayEventLog).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: e.projectId,
      eventId: e.id,
      kind,
      detail: detail ?? null,
      byUser: scope.ctx.userId,
    });
  }

  function checkDates(d: { startedOn: LocalDate; endedOn: LocalDate | null; awareOn: LocalDate }) {
    if (d.endedOn && d.endedOn < d.startedOn)
      throw invalid('endedOn', 'The delay must end on or after the day it began.');
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: EventStatus | undefined },
  ) {
    await staff(scope, projectId);
    const { today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(delayEvents)
      .where(
        and(
          eq(delayEvents.projectId, projectId),
          opts.status ? eq(delayEvents.status, opts.status) : undefined,
        ),
      )
      .orderBy(desc(delayEvents.number))
      .limit(1000);
    const items = await itemsOf(
      scope,
      rows.map((r) => r.id),
    );
    return rows.map((r) =>
      view(
        r,
        items.filter((i) => i.eventId === r.id),
        settings,
        today,
      ),
    );
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    await staff(scope, projectId);
    const { today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const e = await row(scope, projectId, id);
    const items = await itemsOf(scope, [e.id]);
    const history = await scope.tx
      .select()
      .from(delayEventLog)
      .where(eq(delayEventLog.eventId, e.id))
      .orderBy(asc(delayEventLog.at), asc(delayEventLog.id))
      .limit(300);
    return { event: view(e, items, settings, today), items, history, settings };
  }

  async function attach(
    scope: TenantScope,
    projectId: string,
    eventId: string,
    input: EvidenceInput,
    settings: EotSettings,
    tz: string,
    today: LocalDate,
  ) {
    const added: string[] = [];
    const base = { orgId: scope.ctx.orgId, projectId, eventId, addedBy: scope.ctx.userId };
    const keys = [...new Set(input.candidateKeys ?? [])];
    if (keys.length) {
      const all = await buildCandidates(
        scope,
        projectId,
        { from: addDays(today, -LOOKBACK_DAYS), to: today },
        settings,
        tz,
        today,
      );
      const byKey = new Map(all.data.map((c) => [c.key, c]));
      const rows = keys.map((k) => {
        const c = byKey.get(k);
        if (!c)
          throw new AppError(
            'delay_event.source_not_found',
            'That delay, RFI or rain day is no longer on the register.',
          );
        if (c.eventId && c.eventId !== eventId)
          throw new AppError(
            'delay_event.evidence_taken',
            `"${c.label}" is already part of another delay event.`,
          );
        return c;
      });
      const fresh = rows.filter((c) => c.eventId === null);
      if (fresh.length) {
        await scope.tx.insert(delayEventItems).values(
          fresh.map((c) => ({
            id: uuidv7(),
            ...base,
            kind: c.kind,
            sourceKey: c.key,
            onDate: c.date,
            label: c.label.slice(0, 400),
            detail: c.detail,
            hours: c.hours,
            days: c.days,
            rainMm: c.rainMm,
          })),
        );
        added.push(...fresh.map((c) => c.label));
      }
    }
    const corrIds = [...new Set(input.correspondenceIds ?? [])];
    if (corrIds.length) {
      const uuids = corrIds.map((c) => {
        const u = decodeId('correspondence', c);
        if (!u) throw invalid('correspondenceIds', 'Invalid id');
        return u;
      });
      const found = await deps.correspondence.linkSummaries(scope, projectId, uuids);
      const byId = new Map(found.map((f) => [f.id, f]));
      const taken = await attachedKeys(scope, projectId);
      const rows = uuids.map((u) => {
        const f = byId.get(u);
        if (!f)
          throw new AppError('delay_event.source_not_found', 'That notice is not on this project.');
        const owner = taken.get(`corr:${u}`);
        if (owner && owner !== eventId)
          throw new AppError(
            'delay_event.evidence_taken',
            `${f.ref} is already part of another delay event.`,
          );
        return owner ? null : f;
      });
      const fresh = rows.filter((f): f is NonNullable<typeof f> => f !== null);
      if (fresh.length) {
        await scope.tx.insert(delayEventItems).values(
          fresh.map((f) => ({
            id: uuidv7(),
            ...base,
            kind: 'correspondence' as const,
            sourceKey: `corr:${f.id}`,
            onDate: null,
            label: `${f.ref} ${f.title}`.slice(0, 400),
            detail: `Status: ${f.status}`,
          })),
        );
        added.push(...fresh.map((f) => f.ref));
      }
    }
    for (const n of input.notes ?? []) {
      await scope.tx.insert(delayEventItems).values({
        id: uuidv7(),
        ...base,
        kind: 'note',
        sourceKey: null,
        onDate: n.date ?? null,
        label: n.label.trim().slice(0, 400),
        detail: text(n.detail),
      });
      added.push(n.label.trim());
    }
    return added;
  }

  async function create(scope: TenantScope, projectId: string, input: EventInput) {
    await staff(scope, projectId);
    const { project, today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const title = input.title.trim();
    if (!title) throw invalid('title', 'Enter a title.');
    const next = {
      startedOn: input.startedOn,
      endedOn: input.endedOn ?? null,
      awareOn: input.awareOn ?? input.startedOn,
    };
    checkDates(next);
    await scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'delay_event:' + projectId}, 0))`,
    );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${delayEvents.number}), 0) + 1` })
      .from(delayEvents)
      .where(eq(delayEvents.projectId, projectId));
    const [e] = await scope.tx
      .insert(delayEvents)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        title,
        cause: input.cause,
        ...next,
        criticalPath: input.criticalPath ?? null,
        summary: text(input.summary),
        affected: text(input.affected),
        daysClaimed: input.daysClaimed ?? 0,
        noticeDueOn: input.noticeDueOn ?? null,
        claimDueOn: input.claimDueOn ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await log(scope, e!, 'created');
    if (input.candidateKeys?.length) {
      const added = await attach(
        scope,
        projectId,
        e!.id,
        { candidateKeys: input.candidateKeys },
        settings,
        project.timezone,
        today,
      );
      if (added.length) await log(scope, e!, 'evidence_added', `${added.length} items`);
    }
    return (await get(scope, projectId, e!.id)).event;
  }

  async function update(scope: TenantScope, projectId: string, id: string, patch: EventPatch) {
    await staff(scope, projectId);
    const cur = await row(scope, projectId, id, true);
    if (cur.status === 'closed' || cur.status === 'withdrawn')
      throw new AppError('delay_event.bad_state', 'Reopen the event before changing it.');
    const next = {
      startedOn: patch.startedOn ?? cur.startedOn,
      endedOn: patch.endedOn === undefined ? cur.endedOn : patch.endedOn,
      awareOn: patch.awareOn ?? cur.awareOn,
    };
    checkDates(next);
    if (patch.title !== undefined && !patch.title.trim()) throw invalid('title', 'Enter a title.');
    await scope.tx
      .update(delayEvents)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.cause ? { cause: patch.cause } : {}),
        ...next,
        ...(patch.criticalPath !== undefined ? { criticalPath: patch.criticalPath } : {}),
        ...(patch.summary !== undefined ? { summary: text(patch.summary) } : {}),
        ...(patch.affected !== undefined ? { affected: text(patch.affected) } : {}),
        ...(patch.daysClaimed !== undefined ? { daysClaimed: patch.daysClaimed } : {}),
        ...(patch.noticeDueOn !== undefined ? { noticeDueOn: patch.noticeDueOn } : {}),
        ...(patch.claimDueOn !== undefined ? { claimDueOn: patch.claimDueOn } : {}),
        updatedAt: now(),
        version: cur.version + 1,
      })
      .where(eq(delayEvents.id, cur.id));
    await log(scope, cur, 'updated');
    return (await get(scope, projectId, id)).event;
  }

  async function addEvidence(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: EvidenceInput,
  ) {
    await staff(scope, projectId);
    const { project, today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const e = await row(scope, projectId, id, true);
    if (e.status === 'closed' || e.status === 'withdrawn')
      throw new AppError('delay_event.bad_state', 'Reopen the event before changing its evidence.');
    const added = await attach(scope, projectId, e.id, input, settings, project.timezone, today);
    if (added.length) await log(scope, e, 'evidence_added', added.slice(0, 5).join('; '));
    return get(scope, projectId, id);
  }

  async function removeEvidence(scope: TenantScope, projectId: string, id: string, itemId: string) {
    await staff(scope, projectId);
    const e = await row(scope, projectId, id, true);
    if (e.status === 'closed' || e.status === 'withdrawn')
      throw new AppError('delay_event.bad_state', 'Reopen the event before changing its evidence.');
    const gone = await scope.tx
      .delete(delayEventItems)
      .where(and(eq(delayEventItems.id, itemId), eq(delayEventItems.eventId, e.id)))
      .returning({ label: delayEventItems.label });
    if (gone.length === 0) throw new AppError('delay_event.evidence_not_found');
    await log(scope, e, 'evidence_removed', gone[0]!.label);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: TransitionInput,
  ) {
    await staff(scope, projectId);
    const { today } = await context(scope, projectId);
    const e = await row(scope, projectId, id, true);
    if (!canDo(e.status, input.action))
      throw new AppError(
        'delay_event.bad_state',
        `You can't do that to an event that is ${e.status.replace('_', ' ')}. It works from ${ACTION_FROM[input.action].join(', ').replace(/_/g, ' ')}.`,
      );
    const on = input.on ?? today;
    if (on > today) throw invalid('on', 'The date cannot be in the future.');
    let ref: { id: string; label: string } | null = null;
    if (input.correspondenceId) {
      const u = decodeId('correspondence', input.correspondenceId);
      if (!u) throw invalid('correspondenceId', 'Invalid id');
      const [f] = await deps.correspondence.linkSummaries(scope, projectId, [u]);
      if (!f)
        throw new AppError('delay_event.source_not_found', 'That notice is not on this project.');
      ref = { id: f.id, label: `${f.ref} ${f.title}`.slice(0, 200) };
    }
    const set: Partial<typeof delayEvents.$inferInsert> = {};
    let kind: string = input.action;
    let detail: string | undefined = text(input.note) ?? undefined;
    switch (input.action) {
      case 'give_notice':
        set.status = 'notice_given';
        set.noticeSentOn = on;
        if (ref) Object.assign(set, { noticeRefId: ref.id, noticeRefLabel: ref.label });
        kind = 'notice_given';
        break;
      case 'submit_claim': {
        const days = input.daysClaimed ?? e.daysClaimed;
        if (days < 1) throw invalid('daysClaimed', 'Enter the days you are claiming.');
        set.status = 'claimed';
        set.claimSentOn = on;
        set.daysClaimed = days;
        if (ref) Object.assign(set, { claimRefId: ref.id, claimRefLabel: ref.label });
        kind = 'claim_submitted';
        detail = `${days} days claimed`;
        break;
      }
      case 'record_assessment':
        if (input.daysGranted === undefined)
          throw invalid('daysGranted', 'Enter the days the superintendent granted (0 if none).');
        set.status = 'assessed';
        set.assessedOn = on;
        set.daysGranted = input.daysGranted;
        set.assessmentNote = text(input.note);
        kind = 'assessed';
        detail = `${input.daysGranted} days granted`;
        break;
      case 'close':
        set.status = 'closed';
        kind = 'closed';
        break;
      case 'withdraw':
        set.status = 'withdrawn';
        kind = 'withdrawn';
        break;
      case 'reopen':
        set.status = e.assessedOn
          ? 'assessed'
          : e.claimSentOn
            ? 'claimed'
            : e.noticeSentOn
              ? 'notice_given'
              : 'draft';
        kind = 'reopened';
        break;
    }
    await scope.tx
      .update(delayEvents)
      .set({ ...set, updatedAt: now(), version: e.version + 1 })
      .where(eq(delayEvents.id, e.id));
    await log(scope, e, kind, detail);
    return (await get(scope, projectId, id)).event;
  }

  // ---- Nova: flags and drafts -------------------------------------------------------------------------------

  async function insights(scope: TenantScope, projectId: string) {
    await staff(scope, projectId);
    const { project, today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const events = await list(scope, projectId, {});
    const cand = await buildCandidates(
      scope,
      projectId,
      { from: addDays(today, -LOOKBACK_DAYS), to: today },
      settings,
      project.timezone,
      today,
    );
    const open = events.filter((e) => LIVE_STATUSES.includes(e.status));
    const wetDaysUsed = events
      .filter((e) => e.status !== 'withdrawn')
      .reduce((n, e) => n + e.evidence.rainDays, 0);
    const flags = computeFlags({
      today,
      settings,
      events: open,
      untracked: cand.data
        .filter((c) => c.eventId === null && c.possibleEot)
        .map((c) => ({ date: c.date, label: c.label })),
      wetDaysUsed,
    });
    const idOf = (e: EventView) => e.id;
    const live = events.filter((e) => e.status !== 'withdrawn');
    return {
      asOf: now(),
      today,
      flags,
      summary: {
        events: events.length,
        open: open.length,
        daysClaimed: live
          .filter((e) => e.status === 'claimed' || e.status === 'assessed' || e.status === 'closed')
          .reduce((n, e) => n + (e.claimSentOn ? e.daysClaimed : 0), 0),
        daysGranted: live.reduce((n, e) => n + (e.daysGranted ?? 0), 0),
        awaitingAssessment: live.filter((e) => e.status === 'claimed').length,
        untrackedDelays: cand.data.filter((c) => c.eventId === null && c.possibleEot).length,
        wetDays: wetDaysUsed,
        wetDayAllowance: settings.wetDayAllowance,
        periodsConfirmed: settings.confirmed,
        eventIds: open.map(idOf),
      },
    };
  }

  async function draft(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { kind: 'notice' | 'claim'; senderName?: string | undefined },
  ): Promise<Draft & { eventId: string }> {
    await staff(scope, projectId);
    const { project, today } = await context(scope, projectId);
    const settings = await getSettings(scope, projectId);
    const e = await row(scope, projectId, id);
    const items = await itemsOf(scope, [e.id]);
    const d = draftEotLetter({
      kind: input.kind,
      projectName: project.name,
      senderName: input.senderName?.trim() || 'The project team',
      today,
      settings,
      event: {
        number: e.number,
        title: e.title,
        cause: e.cause,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        awareOn: e.awareOn,
        daysClaimed: e.daysClaimed,
        criticalPath: e.criticalPath,
        summary: e.summary,
        affected: e.affected,
        noticeSentOn: e.noticeSentOn,
        noticeRefLabel: e.noticeRefLabel,
      },
      items: items.map(toEvidence),
    });
    await log(scope, e, 'drafted', `${input.kind} draft for ${eventRef(e.number)}`);
    return { ...d, eventId: e.id };
  }

  return {
    getSettings,
    putSettings,
    candidates,
    list,
    get,
    create,
    update,
    addEvidence,
    removeEvidence,
    transition,
    insights,
    draft,
  };
}

export type EotService = ReturnType<typeof createEotService>;
