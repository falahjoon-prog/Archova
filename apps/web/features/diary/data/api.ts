// The site diary against the diary module's endpoints (Ben's PR #23), with the same interface as the preview
// source so the screen and hooks don't change. The screen edits the whole day and saves it as one draft; the API
// keeps each labour, plant, delivery, visitor, delay and stand-down line separately, so a save works out which
// lines to create, change or remove. After submit every write carries the amendment reason (X42).

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { addDays, type LocalDate } from '@archova/time';
import type { Citation } from '@archova/ui';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { projectMembers, type ProjectPerson } from '@/shared/lib/people';
import { mockId } from '@/shared/mocks/runtime';
import { copyLabour } from '../lib/entry';
import type { Amendment, DiaryContent, DiaryEntry, StandDown, Weather } from '../lib/types';
import { emptyContent, type DiarySource } from './source';

type S = components['schemas'];
type ApiEntry = S['DiaryEntry'];
type ApiDetail = S['DiaryEntryDetail'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/diary' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

// ------------------------------------------------------------------------------------------------ reading

function toWeather(w: S['DiaryWeather'] | null, stationId: string | null): Weather | null {
  if (!w) return null;
  return {
    stationId,
    stationName: null,
    minC: w.minTempC ?? null,
    maxC: w.maxTempC ?? null,
    rainMm: w.rainfallMm ?? null,
    windKmh: w.windKmh ?? null,
    conditions: {
      at7am: w.conditions?.am ?? null,
      at12pm: w.conditions?.midday ?? null,
      at3pm: w.conditions?.pm ?? null,
    },
  };
}

function toStandDown(s: S['DiaryStandDown'] | undefined): StandDown {
  return s
    ? { active: true, start: s.startTime, end: s.endTime, companyIds: s.affectedCompanyIds }
    : { active: false, start: null, end: null, companyIds: [] };
}

export function toContent(d: ApiDetail): DiaryContent {
  return {
    weatherNotes: d.entry.weatherNotes ?? '',
    standDown: toStandDown(d.standDowns[0]),
    labour: d.labour.map((l) => ({
      id: l.id,
      companyId: l.companyId,
      trade: l.trade ?? '',
      headcount: l.headcount,
      hours: l.hours,
    })),
    plant: d.plant.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      hours: l.hours,
      status: l.status,
    })),
    deliveries: d.deliveries.map((l) => ({
      id: l.id,
      supplier: l.supplierName ?? '',
      description: l.description,
      docketNumber: l.docketNumber ?? '',
      receivedAt: l.receivedAt,
    })),
    visitors: d.visitors.map((l) => ({
      id: l.id,
      name: l.name,
      company: l.company ?? '',
      purpose: l.purpose ?? '',
    })),
    delays: d.delays.map((l) => ({
      id: l.id,
      type: l.type,
      hours: l.hours,
      description: l.description,
      affectedCompanyIds: l.affectedCompanyIds,
      isEotCandidate: l.isEotCandidate,
    })),
    notes: d.entry.notes ?? '',
    photoIds: d.entry.fileIds,
  };
}

const SECTIONS: Record<S['DiaryAmendment']['targetType'], string> = {
  entry: 'Day',
  labour: 'Labour',
  plant: 'Plant',
  delivery: 'Deliveries',
  delay: 'Delays',
  visitor: 'Visitors',
  event: 'Events',
  stand_down: 'Stand-down',
};

const FIELDS: Record<string, string> = {
  companyId: 'company',
  supplierCompanyId: 'supplier',
  supplierName: 'supplier',
  docketNumber: 'docket',
  isEotCandidate: 'possible EOT',
  affectedCompanyIds: 'companies affected',
  startTime: 'start',
  endTime: 'end',
  timeIn: 'time in',
  timeOut: 'time out',
  weatherNotes: 'weather notes',
  weatherOverride: 'weather correction',
  siteConditions: 'site conditions',
  fileIds: 'photos',
  receivedAt: 'received',
};

/** Amendment values as text. Company ids stay ids here; the screen names them from the project directory. */
function showValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  if (field === 'fileIds' && Array.isArray(v))
    return `${v.length} ${v.length === 1 ? 'photo' : 'photos'}`;
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : 'none';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return 'changed';
  return String(v);
}

function toAmendment(a: S['DiaryAmendment'], members: readonly ProjectPerson[]): Amendment {
  const section = SECTIONS[a.targetType];
  const entries = Object.entries(a.changes) as Array<[string, [unknown, unknown]]>;
  const label = (side: 0 | 1) => {
    const values = Object.fromEntries(entries.map(([k, v]) => [k, v[side]]));
    const main = values.description ?? values.name ?? values.companyId ?? values.startTime;
    return main ? showValue('', main) : section.toLowerCase();
  };
  const changes =
    a.action === 'create'
      ? [{ field: section, before: 'none', after: label(1) }]
      : a.action === 'delete'
        ? [{ field: section, before: label(0), after: 'removed' }]
        : entries.map(([field, [before, after]]) => ({
            field: `${section} · ${FIELDS[field] ?? field}`,
            before: showValue(field, before),
            after: showValue(field, after),
          }));
  return {
    id: a.id,
    reason: a.reason,
    changes,
    by: members.find((m) => m.id === a.amendedBy)?.name ?? 'Project member',
    at: a.amendedAt,
  };
}

function toEntry(
  e: ApiEntry,
  detail: ApiDetail | null,
  members: readonly ProjectPerson[],
): DiaryEntry {
  const name = (id: string | null) =>
    id ? (members.find((m) => m.id === id)?.name ?? 'Project member') : null;
  return {
    date: e.date,
    status: e.status,
    // The site manager's correction wins over the observations; the API keeps both (DIA-AC2).
    weather: toWeather(e.weatherOverride ?? e.weather, e.weatherStationId),
    content: detail ? toContent(detail) : toContent(emptyDetail(e)),
    original: null,
    amendments: detail ? detail.amendments.map((a) => toAmendment(a, members)) : [],
    submittedBy: name(e.submittedBy),
    submittedAt: e.submittedAt,
    late: e.isLate,
    signedOffBy: name(e.signedOffBy),
    signedOffAt: e.signedOffAt,
    // There's no "photos taken today" lookup yet, so the day offers the photos already attached.
    photosToday: e.fileIds.map((id, i) => ({ id, caption: `Photo ${i + 1}`, takenAt: '' })),
    version: e.version,
  };
}

const emptyDetail = (entry: ApiEntry): ApiDetail => ({
  entry,
  labour: [],
  plant: [],
  deliveries: [],
  delays: [],
  visitors: [],
  events: [],
  standDowns: [],
  amendments: [],
});

// ------------------------------------------------------------------------------------------------ writing

type Kind = 'labour' | 'plant' | 'deliveries' | 'visitors' | 'delays';
type Local<K extends Kind> = DiaryContent[K][number];

/**
 * Per section: the API path, when a line is complete enough to save (the API refuses blank descriptions), and the
 * request body. Incomplete lines stay on screen and are saved once filled in.
 */
const LINES: {
  [K in Kind]: { path: string; ready: (l: Local<K>) => boolean; body: (l: Local<K>) => object };
} = {
  labour: {
    path: 'labour',
    ready: (l) => !!l.companyId,
    body: (l) => ({
      companyId: l.companyId,
      trade: l.trade.trim() || null,
      headcount: l.headcount,
      hours: l.hours,
    }),
  },
  plant: {
    path: 'plant',
    ready: (l) => !!l.description.trim(),
    body: (l) => ({
      description: l.description.trim(),
      quantity: l.quantity,
      hours: l.hours,
      status: l.status,
    }),
  },
  deliveries: {
    path: 'deliveries',
    ready: (l) => !!l.description.trim(),
    body: (l) => ({
      supplierName: l.supplier.trim() || null,
      description: l.description.trim(),
      docketNumber: l.docketNumber.trim() || null,
      receivedAt: l.receivedAt,
    }),
  },
  visitors: {
    path: 'visitors',
    ready: (l) => !!l.name.trim(),
    body: (l) => ({
      name: l.name.trim(),
      company: l.company.trim() || null,
      purpose: l.purpose.trim() || null,
    }),
  },
  delays: {
    path: 'delays',
    ready: (l) => !!l.description.trim() && l.hours !== null,
    body: (l) => ({
      type: l.type,
      description: l.description.trim(),
      hours: l.hours,
      affectedCompanyIds: l.affectedCompanyIds,
      isEotCandidate: l.isEotCandidate,
    }),
  },
};

const standDownBody = (s: StandDown) => ({
  startTime: s.start,
  endTime: s.end,
  affectedCompanyIds: s.companyIds,
});

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a: readonly string[], b: readonly string[]) => same([...a].sort(), [...b].sort());

// The line endpoints share one shape per section; the generated client types them path by path, so the section
// table goes through this narrower view of it.
type LineCall = (
  path: string,
  init: {
    params: {
      path: Record<string, string>;
      header?: Record<string, string>;
      query?: Record<string, string>;
    };
    body?: object;
  },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
const lineApi = api as unknown as { POST: LineCall; PATCH: LineCall; DELETE: LineCall };

/**
 * Lines the screen created get a server id on their first save. The screen keeps its own ids while it's open, so
 * the next save maps them here rather than creating the line twice.
 */
const savedAs = new Map<string, string>();

/** Saves of one day run one after another, so a slow autosave can't race the next one. */
const queues = new Map<string, Promise<unknown>>();
function serially<T>(key: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
  queues.set(key, next);
  return next;
}

export function createDiaryApi(orgId: string): DiarySource {
  const members = (projectId: string) => projectMembers(orgId, projectId);

  async function fetchDetail(projectId: string, date: LocalDate): Promise<ApiDetail | null> {
    const r = await api.GET(`${P}/{date}`, { params: { path: { orgId, projectId, date } } });
    if (r.response.status === 404) return null;
    return unwrap(r);
  }

  async function view(projectId: string, d: ApiDetail): Promise<DiaryEntry> {
    return toEntry(d.entry, d, await members(projectId));
  }

  /** A day nobody has written yet: blank, with the last entry's companies and trades copied in (DIA-AC3). */
  async function newDay(projectId: string, date: LocalDate): Promise<DiaryEntry> {
    const recent = unwrap(
      await api.GET(P, {
        params: {
          path: { orgId, projectId },
          query: { from: addDays(date, -30), to: addDays(date, -1) },
        },
      }),
    ).data;
    const last = [...recent].sort((a, b) => b.date.localeCompare(a.date))[0];
    const previous = last ? await fetchDetail(projectId, last.date) : null;
    const labour = previous ? copyLabour(toContent(previous).labour, () => mockId('lab')) : [];
    return {
      date,
      status: 'draft',
      weather: null,
      content: { ...emptyContent(), labour },
      original: null,
      amendments: [],
      submittedBy: null,
      submittedAt: null,
      late: false,
      signedOffBy: null,
      signedOffAt: null,
      photosToday: [],
    };
  }

  /** Brings the server's copy of the day in line with what's on screen. */
  async function sync(
    projectId: string,
    date: LocalDate,
    content: DiaryContent,
    reason?: string,
  ): Promise<ApiDetail | null> {
    await ensureCsrfToken();
    const path = { orgId, projectId, date };
    const amendment = reason ? { amendmentReason: reason.trim() } : {};
    const removal = reason ? { query: { amendmentReason: reason.trim() } } : {};
    let detail = await fetchDetail(projectId, date);

    const syncSection = async <K extends Kind>(kind: K) => {
      const spec = LINES[kind] as unknown as {
        path: string;
        ready: (l: Local<Kind>) => boolean;
        body: (l: Local<Kind>) => object;
      };
      const onServer = detail ? (toContent(detail)[kind] as Array<Local<Kind>>) : [];
      const versions = new Map(
        (detail?.[kind] ?? []).map((l: { id: string; version: number }) => [l.id, l.version]),
      );
      const kept = new Set<string>();
      for (const line of content[kind] as Array<Local<Kind>>) {
        const id = savedAs.get(line.id) ?? line.id;
        const current = onServer.find((s) => s.id === id);
        if (current) {
          kept.add(id);
          if (!spec.ready(line) || same(spec.body(line), spec.body(current))) continue;
          unwrap(
            await lineApi.PATCH(`${P}/{date}/${spec.path}/{lineId}`, {
              params: { path: { ...path, lineId: id }, header: ifMatch(versions.get(id)!) },
              body: { ...spec.body(line), ...amendment },
            }),
          );
        } else if (spec.ready(line)) {
          const created = unwrap(
            await lineApi.POST(`${P}/{date}/${spec.path}`, {
              params: { path, header: idempotencyKey() },
              body: { ...spec.body(line), ...amendment },
            }),
          ) as { id: string };
          savedAs.set(line.id, created.id);
          kept.add(created.id);
        }
      }
      for (const s of onServer) {
        if (kept.has(s.id)) continue;
        unwrap(
          await lineApi.DELETE(`${P}/{date}/${spec.path}/{lineId}`, {
            params: { path: { ...path, lineId: s.id }, ...removal },
          }),
        );
      }
    };
    for (const kind of Object.keys(LINES) as Kind[]) await syncSection(kind);

    // The screen shows one stand-down per day; others recorded on a phone are left as they are.
    const sd = detail?.standDowns[0];
    const want = content.standDown;
    if (sd && !want.active) {
      unwrap(
        await lineApi.DELETE(`${P}/{date}/stand-downs/{lineId}`, {
          params: { path: { ...path, lineId: sd.id }, ...removal },
        }),
      );
    } else if (want.active && want.start) {
      if (!sd) {
        unwrap(
          await lineApi.POST(`${P}/{date}/stand-downs`, {
            params: { path, header: idempotencyKey() },
            body: { ...standDownBody(want), ...amendment },
          }),
        );
      } else if (!same(standDownBody(want), standDownBody(toStandDown(sd)))) {
        unwrap(
          await lineApi.PATCH(`${P}/{date}/stand-downs/{lineId}`, {
            params: { path: { ...path, lineId: sd.id }, header: ifMatch(sd.version) },
            body: { ...standDownBody(want), ...amendment },
          }),
        );
      }
    }

    // Line writes (and amendments) move the day's version, so the header goes last against a fresh read.
    detail = await fetchDetail(projectId, date);
    const e = detail?.entry;
    const header = {
      weatherNotes: content.weatherNotes.trim() || null,
      notes: content.notes.trim() ? content.notes : null,
      fileIds: content.photoIds,
    };
    const changed = e
      ? (e.weatherNotes ?? null) !== header.weatherNotes ||
        (e.notes ?? null) !== header.notes ||
        !sameSet(e.fileIds, header.fileIds)
      : !!(header.weatherNotes || header.notes || header.fileIds.length);
    if (changed) {
      detail = unwrap(
        await api.PUT(`${P}/{date}`, {
          params: { path, ...(e ? { header: ifMatch(e.version) } : {}) },
          body: { ...header, ...amendment },
        }),
      );
    }
    return detail;
  }

  async function ensured(projectId: string, date: LocalDate): Promise<ApiDetail> {
    const d = await fetchDetail(projectId, date);
    if (d) return d;
    await ensureCsrfToken();
    return unwrap(
      await api.PUT(`${P}/{date}`, { params: { path: { orgId, projectId, date } }, body: {} }),
    );
  }

  return {
    async list(projectId, from, to) {
      const [rows, people] = await Promise.all([
        api.GET(P, { params: { path: { orgId, projectId }, query: { from, to } } }).then(unwrap),
        members(projectId),
      ]);
      return rows.data.map((e) => toEntry(e, null, people));
    },

    async getDay(projectId, date, today) {
      const d = await fetchDetail(projectId, date);
      if (d) return view(projectId, d);
      if (date > today)
        throw new ApiError(422, {
          type: 'about:blank',
          title: 'Future day',
          status: 422,
          detail: 'You can’t start a diary for a future day.',
          code: 'diary.future_date',
        } as never);
      return newDay(projectId, date);
    },

    saveDraft: (projectId, date, content) =>
      serially(`${projectId}:${date}`, async () => {
        const d = await sync(projectId, date, content);
        return d ? view(projectId, d) : newDay(projectId, date);
      }),

    submit: (projectId, date, content) =>
      serially(`${projectId}:${date}`, async () => {
        await sync(projectId, date, content);
        const d = await ensured(projectId, date);
        return view(
          projectId,
          unwrap(
            await api.POST(`${P}/{date}/submit`, {
              params: { path: { orgId, projectId, date }, header: ifMatch(d.entry.version) },
              body: { clientAt: new Date().toISOString() },
            }),
          ),
        );
      }),

    amend: (projectId, date, content, reason) =>
      serially(`${projectId}:${date}`, async () => {
        const d = await sync(projectId, date, content, reason);
        return view(projectId, d ?? (await ensured(projectId, date)));
      }),

    async signOff(projectId, date) {
      await ensureCsrfToken();
      const d = await ensured(projectId, date);
      return view(
        projectId,
        unwrap(
          await api.POST(`${P}/{date}/sign-off`, {
            params: { path: { orgId, projectId, date }, header: ifMatch(d.entry.version) },
          }),
        ),
      );
    },

    async novaSummary(): Promise<{ id: string; text: string; citations: Citation[] }> {
      throw new ApiError(501, {
        type: 'about:blank',
        title: 'Not available yet',
        status: 501,
        detail: "Nova can't summarise the diary on this project yet.",
        code: 'ai.not_available',
      } as never);
    },
  };
}
