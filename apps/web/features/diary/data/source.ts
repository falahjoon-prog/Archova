// Site diary data source, mirroring `GET {p}/diary?from=&to=`, `PUT {p}/diary/{date}` (and its child line
// endpoints), `POST {p}/diary/{date}/submit|sign-off|amendments` (backend 04 §3). Preview: in-memory store with
// synthetic BOM-style weather; Nova's summary is canned but cites the lines it used.

import type { LocalDate } from '@archova/time';
import type { Citation } from '@archova/ui';
import { companyName } from '@/shared/mocks/directory';
import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import {
  copyLabour,
  diffContent,
  isLateSubmission,
  labourTotals,
  submitProblems,
} from '../lib/entry';
import type { DiaryContent, DiaryEntry, DiaryPhoto, Weather } from '../lib/types';

interface Actor {
  id: string;
  name: string;
}

const CONDITIONS = ['Fine', 'Partly cloudy', 'Cloudy', 'Showers', 'Rain'] as const;

/** Synthetic weather that's stable per date (a hash of the date picks the values). */
export function mockWeather(date: LocalDate): Weather {
  const h = [...date].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
  const rain = h % 5 === 0 ? 14 + (h % 9) : h % 3 === 0 ? 2 : 0;
  const pick = (k: number) => CONDITIONS[rain > 10 ? 3 + (k % 2) : (h + k) % 3]!;
  return {
    stationId: '066214',
    stationName: 'Sydney (Observatory Hill)',
    minC: 10 + (h % 6),
    maxC: 19 + (h % 8),
    rainMm: rain,
    windKmh: 8 + (h % 25),
    conditions: { at7am: pick(0), at12pm: pick(1), at3pm: pick(2) },
  };
}

export function emptyContent(): DiaryContent {
  return {
    weatherNotes: '',
    standDown: { active: false, start: null, end: null, companyIds: [] },
    labour: [],
    plant: [],
    deliveries: [],
    visitors: [],
    delays: [],
    notes: '',
    photoIds: [],
  };
}

function photosFor(date: LocalDate): DiaryPhoto[] {
  return [
    { id: `pho_${date}_1`, caption: 'Level 2 slab pour, east bay', takenAt: `${date}T00:15:00Z` },
    { id: `pho_${date}_2`, caption: 'Formwork stripped at grid C', takenAt: `${date}T02:40:00Z` },
    { id: `pho_${date}_3`, caption: 'Delivery of reinforcement', takenAt: `${date}T04:05:00Z` },
  ];
}

const lab = (companyId: string, trade: string, headcount: number, hours: number) => ({
  id: mockId('lab'),
  companyId,
  trade,
  headcount,
  hours,
});

function seedEntry(
  date: LocalDate,
  partial: Partial<DiaryEntry>,
  content: Partial<DiaryContent>,
): DiaryEntry {
  return {
    date,
    status: 'submitted',
    weather: mockWeather(date),
    content: { ...emptyContent(), ...content },
    original: null,
    amendments: [],
    submittedBy: 'Luca Romano',
    submittedAt: `${date}T07:10:00Z`,
    late: false,
    signedOffBy: null,
    signedOffAt: null,
    photosToday: photosFor(date),
    ...partial,
  };
}

function seed(): Map<LocalDate, DiaryEntry> {
  const crew = [
    lab('cmp_builder', 'Site supervision', 2, 19),
    lab('cmp_form', 'Formwork', 6, 54),
    lab('cmp_elec', 'Electrical', 3, 24),
  ];
  const entries = [
    seedEntry(
      '2026-09-28',
      {},
      {
        labour: crew,
        notes: 'Formwork to level 2 east bay complete. Electrical rough-in level 1 continuing.',
      },
    ),
    seedEntry(
      '2026-09-29',
      {
        late: true,
        submittedAt: '2026-09-30T02:30:00Z',
        original: {
          ...emptyContent(),
          labour: crew.map((l) => ({ ...l })),
          notes: 'Stripping formwork level 1.',
        },
        amendments: [
          {
            id: 'amd_1',
            reason: 'Electrical crew numbers confirmed from their timesheet.',
            changes: [
              { field: 'Labour · Brightwire Electrical headcount', before: '3', after: '4' },
            ],
            by: 'Luca Romano',
            at: '2026-09-30T03:00:00Z',
          },
        ],
      },
      {
        labour: crew.map((l) =>
          l.companyId === 'cmp_elec' ? { ...l, headcount: 4, hours: 32 } : { ...l },
        ),
        notes: 'Stripping formwork level 1.',
      },
    ),
    seedEntry(
      '2026-09-30',
      { status: 'signed_off', signedOffBy: 'Dana Okafor', signedOffAt: '2026-10-01T05:00:00Z' },
      {
        labour: crew.map((l) => ({ ...l })),
        deliveries: [
          {
            id: mockId('del'),
            supplier: 'Steelline Reinforcing',
            description: 'N12 bar and mesh',
            docketNumber: 'SR-44817',
            receivedAt: '2026-09-29T22:30:00Z',
          },
        ],
        notes: 'Reinforcement for level 2 slab delivered and checked.',
      },
    ),
    seedEntry(
      '2026-10-01',
      {
        weather: {
          ...mockWeather('2026-10-01'),
          rainMm: 18,
          conditions: { at7am: 'Rain', at12pm: 'Rain', at3pm: 'Showers' },
        },
      },
      {
        labour: crew.map((l) => ({ ...l, hours: (l.hours ?? 0) / 2 })),
        standDown: { active: true, start: '11:00', end: '15:30', companyIds: ['cmp_form'] },
        delays: [
          {
            id: mockId('dly'),
            type: 'weather',
            hours: 4.5,
            description: 'Rain from 11am; formwork crew stood down.',
            affectedCompanyIds: ['cmp_form'],
            isEotCandidate: true,
          },
        ],
        notes: 'Wet afternoon. Level 2 pour moved to Monday.',
      },
    ),
  ];
  return new Map(entries.map((e) => [e.date, e]));
}

const stores = projectStores<Map<LocalDate, DiaryEntry>>(seed);

function newDraft(store: Map<LocalDate, DiaryEntry>, date: LocalDate): DiaryEntry {
  const previous = [...store.values()]
    .filter((e) => e.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    date,
    status: 'draft',
    weather: mockWeather(date),
    content: {
      ...emptyContent(),
      labour: previous ? copyLabour(previous.content.labour, () => mockId('lab')) : [],
    },
    original: null,
    amendments: [],
    submittedBy: null,
    submittedAt: null,
    late: false,
    signedOffBy: null,
    signedOffAt: null,
    photosToday: photosFor(date),
  };
}

function find(projectId: string, date: LocalDate): DiaryEntry {
  const e = stores.get(projectId).get(date);
  if (!e) problem(404, 'not_found', 'There is no diary entry for that day yet.');
  return e;
}

export const diarySource = {
  /** Entries in a date range, for the day strip and missed-day checks. */
  async list(projectId: string, from: LocalDate, to: LocalDate): Promise<DiaryEntry[]> {
    const rows = [...stores.get(projectId).values()].filter((e) => e.date >= from && e.date <= to);
    return delay(rows);
  },

  /**
   * One day. A day with no entry comes back as an unsaved draft pre-filled with the weather and yesterday's labour
   * companies (DIA-US1), so "Diary" opens straight into today with no extra taps (DIA-AC1).
   */
  async getDay(projectId: string, date: LocalDate, today: LocalDate): Promise<DiaryEntry> {
    const store = stores.get(projectId);
    const e = store.get(date);
    if (e) return delay(e);
    if (date > today)
      problem(422, 'diary.future_date', 'You can’t start a diary for a future day.');
    return delay(newDraft(store, date));
  },

  /** Autosaved draft (frontend 02 §5). Refused once the day is submitted: changes are amendments (X42). */
  async saveDraft(projectId: string, date: LocalDate, content: DiaryContent): Promise<DiaryEntry> {
    const store = stores.get(projectId);
    const e = store.get(date) ?? newDraft(store, date);
    if (e.status !== 'draft')
      problem(409, 'diary.locked', 'This day is submitted. Use Amend to change it.');
    e.content = structuredClone(content);
    store.set(date, e);
    return delay(e);
  },

  /** Locks the day and records the submit time; late after the cut-off (DIA-AC7). */
  async submit(
    projectId: string,
    date: LocalDate,
    content: DiaryContent,
    actor: Actor,
    timeZone: string,
  ): Promise<DiaryEntry> {
    const store = stores.get(projectId);
    const e = store.get(date) ?? newDraft(store, date);
    if (e.status !== 'draft') problem(409, 'diary.locked', 'This day is already submitted.');
    const problems = submitProblems(content);
    if (problems.length) problem(422, 'validation', problems[0]!);
    const now = new Date();
    e.content = structuredClone(content);
    e.status = 'submitted';
    e.submittedAt = now.toISOString();
    e.submittedBy = actor.name;
    e.late = isLateSubmission(date, now, timeZone);
    store.set(date, e);
    return delay(e);
  },

  /** An amendment needs a reason; the original stays visible (DIA-AC8, X42). */
  async amend(
    projectId: string,
    date: LocalDate,
    content: DiaryContent,
    reason: string,
    actor: Actor,
  ): Promise<DiaryEntry> {
    const e = find(projectId, date);
    if (e.status === 'draft') problem(409, 'diary.not_submitted', 'Drafts are edited directly.');
    if (!reason.trim()) problem(422, 'validation', 'Give a reason for the amendment.');
    const problems = submitProblems(content);
    if (problems.length) problem(422, 'validation', problems[0]!);
    const changes = diffContent(e.content, content);
    if (!changes.length) problem(422, 'diary.no_changes', 'Nothing has changed.');
    e.original ??= structuredClone(e.content);
    e.content = structuredClone(content);
    e.amendments.push({
      id: mockId('amd'),
      reason: reason.trim(),
      changes,
      by: actor.name,
      at: nowIso(),
    });
    return delay(e);
  },

  /** Optional PM sign-off on top of the lock (DIA-US9). */
  async signOff(projectId: string, date: LocalDate, actor: Actor): Promise<DiaryEntry> {
    const e = find(projectId, date);
    if (e.status !== 'submitted')
      problem(409, 'diary.cannot_sign_off', 'Only submitted days can be signed off.');
    e.status = 'signed_off';
    e.signedOffBy = actor.name;
    e.signedOffAt = nowIso();
    return delay(e);
  },

  // ---- Nova (preview). Production: the ai module, every sentence traceable to an entry line (Ari F4). ----

  async novaSummary(
    date: LocalDate,
    content: DiaryContent,
    weather: Weather | null,
  ): Promise<{ id: string; text: string; citations: Citation[] }> {
    const t = labourTotals(content);
    const sentences: Array<[string, Citation | null]> = [];
    if (content.labour.length) {
      sentences.push([
        `${t.headcount} workers from ${content.labour.length} companies on site for ${t.hours} hours in total.`,
        { id: 'c_lab', label: 'Labour', href: '#diary-labour' },
      ]);
    }
    if (weather) {
      sentences.push([
        `${weather.conditions.at7am} in the morning, ${weather.rainMm} mm of rain recorded at ${weather.stationName}.`,
        { id: 'c_wx', label: 'Weather', href: '#diary-weather' },
      ]);
    }
    content.delays.forEach((d, i) => {
      if (d.description.trim()) {
        sentences.push([
          `Delay: ${d.description.trim()} (${d.hours ?? 0} h).`,
          { id: `c_dly_${i}`, label: `Delay ${i + 1}`, href: '#diary-delays' },
        ]);
      }
    });
    if (content.deliveries.length) {
      sentences.push([
        `Deliveries received: ${content.deliveries.map((d) => d.description || d.supplier).join(', ')}.`,
        { id: 'c_del', label: 'Deliveries', href: '#diary-deliveries' },
      ]);
    }
    if (!sentences.length) {
      return delay({ id: mockId('ais'), text: '', citations: [] }, 300);
    }
    return delay(
      {
        id: mockId('ais'),
        text: sentences.map(([s]) => s).join(' '),
        citations: sentences.flatMap(([, c]) => (c ? [c] : [])),
      },
      300,
    );
  },
};

/** "Possible delay" flag (F1.7 step 3): rain over 10 mm or a stand-down with no weather delay recorded. */
export function possibleDelay(content: DiaryContent, weather: Weather | null): string | null {
  const hasWeatherDelay = content.delays.some((d) => d.type === 'weather');
  if (hasWeatherDelay) return null;
  if (content.standDown.active) {
    return `The site was stood down${content.standDown.companyIds.length ? ` (${content.standDown.companyIds.map(companyName).join(', ')})` : ''} but no weather delay is recorded.`;
  }
  if (weather && weather.rainMm >= 10) {
    return `${weather.rainMm} mm of rain was recorded at ${weather.stationName}, but no weather delay is recorded.`;
  }
  return null;
}

export function resetDiaryPreview() {
  stores.reset();
}
