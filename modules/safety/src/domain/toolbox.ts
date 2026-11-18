// Toolbox talks: the rules in one place. Nothing here calls a model. "Nova" suggestions and the repeat-signature flag are
// plain rules over rows already in the project; a person decides what to run and what a flag means.

export const TOPIC_CATEGORIES = [
  'general',
  'hazard',
  'plant',
  'environment',
  'wellbeing',
  'incident_review',
  'emergency',
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const TALK_STATUSES = ['open', 'closed'] as const;
export type TalkStatus = (typeof TALK_STATUSES)[number];

export const toolboxLabel = (n: number) => `TBT-${String(n).padStart(4, '0')}`;

/** A talk can be closed once at least one attendee has signed and every row on the grid is either signed or removed. */
export function closeBlockers(attendees: { signedAt: Date | null }[]): string[] {
  if (attendees.length === 0) return ['Add the people who attended.'];
  const unsigned = attendees.filter((a) => a.signedAt === null).length;
  return unsigned > 0
    ? [
        `${unsigned} ${unsigned === 1 ? 'person has' : 'people have'} not signed. Sign, or remove them.`,
      ]
    : [];
}

// --- Repeat signatures --------------------------------------------------------------------------------------------

export type RepeatReason = 'shared_between_people' | 'reused_from_earlier_talk';

export interface SignedRow {
  id: string;
  talkId: string;
  personKey: string;
  signatureSha256: string | null;
}

/**
 * A hand-drawn signature is never pixel-identical twice, so the same image on two rows is a copy. Flags (never blocks):
 * - `shared_between_people`: one image on rows for different people in the same talk.
 * - `reused_from_earlier_talk`: this person's image is byte-identical to one they signed with in an earlier talk.
 * `earlier` holds the same person-keyed rows from other talks on the project that were held before this one.
 */
export function repeatSignatureFlags(
  rows: SignedRow[],
  earlier: SignedRow[],
): Map<string, RepeatReason[]> {
  const out = new Map<string, RepeatReason[]>();
  const add = (id: string, r: RepeatReason) =>
    out.set(id, [...new Set([...(out.get(id) ?? []), r])]);
  const byHash = new Map<string, SignedRow[]>();
  for (const r of rows) {
    if (!r.signatureSha256) continue;
    byHash.set(r.signatureSha256, [...(byHash.get(r.signatureSha256) ?? []), r]);
  }
  for (const group of byHash.values()) {
    if (new Set(group.map((g) => g.personKey)).size > 1)
      for (const g of group) add(g.id, 'shared_between_people');
  }
  const seen = new Set(
    earlier.filter((e) => e.signatureSha256).map((e) => `${e.personKey}|${e.signatureSha256}`),
  );
  for (const r of rows)
    if (r.signatureSha256 && seen.has(`${r.personKey}|${r.signatureSha256}`))
      add(r.id, 'reused_from_earlier_talk');
  return out;
}

export const personKey = (name: string, companyId: string | null) =>
  `${name.trim().toLowerCase()}|${companyId ?? ''}`;

// --- Nova topic suggestions (rules) --------------------------------------------------------------------------------

export type SuggestionReason =
  'recent_incident' | 'swms_in_force' | 'not_run_recently' | 'never_run';

export interface TopicSuggestion {
  reason: SuggestionReason;
  /** An existing topic to run, or null when the library has nothing that fits (the title is then a starting point). */
  topicId: string | null;
  title: string;
  /** One plain sentence saying why, with the facts it is based on. */
  because: string;
  hrcwCategory: string | null;
}

const INCIDENT_TITLES: Record<string, string> = {
  injury: 'Reporting injuries and first aid on site',
  near_miss: 'Near misses: what we saw and what we changed',
  property_damage: 'Protecting plant, materials and finished work',
  environmental: 'Spills, dust and runoff on site',
  dangerous_occurrence: 'Dangerous incidents and what to do next',
};

const HRCW_TITLES: Record<string, string> = {
  fall_2m: 'Working at heights: edges, harnesses and ladders',
  asbestos: 'Asbestos: stop, report and keep clear',
  confined_space: 'Confined space entry and permits',
  shaft_trench_tunnel: 'Trenching and excavation safety',
  energised_electrical: 'Electrical safety and isolation',
  mobile_plant: 'Working around mobile plant',
  traffic_corridor: 'Traffic management and exclusion zones',
  temp_support: 'Temporary works and propping',
  tilt_up_precast: 'Tilt-up and precast lifts',
  chemical_fuel_refrigerant: 'Chemicals, fuels and refrigerants',
  pressurised_gas: 'Gas cylinders and pressurised systems',
  demolition_load_bearing: 'Demolition of load-bearing structure',
  demolition_integrity: 'Demolition and structural integrity',
  extreme_temperature: 'Working in extreme temperatures',
  contaminated_atmosphere: 'Contaminated atmospheres and gas testing',
  drowning: 'Working over or near water',
  explosives: 'Explosives and blasting',
  telco_tower: 'Telecommunication towers',
  diving: 'Diving work',
};

const STALE_DAYS = 45;
const RECENT_DAYS = 30;

export interface SuggestInput {
  topics: { id: string; title: string; hrcwCategory: string | null; category: string }[];
  /** Last time each topic was run, as an ISO instant. */
  lastRun: Map<string, Date>;
  recentIncidentTypes: { type: string; count: number }[];
  swmsCategories: string[];
  now: Date;
  limit?: number;
}

const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export function suggestTopics(i: SuggestInput): TopicSuggestion[] {
  const out: TopicSuggestion[] = [];
  const covered = new Set<string>();
  const recentlyRun = (id: string) => {
    const at = i.lastRun.get(id);
    return at !== undefined && daysBetween(i.now, at) < RECENT_DAYS;
  };

  for (const inc of i.recentIncidentTypes) {
    const title = INCIDENT_TITLES[inc.type];
    if (!title) continue;
    const match = i.topics.find((t) => t.category === 'incident_review' && t.title === title);
    if (match && recentlyRun(match.id)) continue;
    out.push({
      reason: 'recent_incident',
      topicId: match?.id ?? null,
      title,
      because: `${inc.count} ${inc.type.replace(/_/g, ' ')} ${inc.count === 1 ? 'report' : 'reports'} on this project in the last ${RECENT_DAYS} days.`,
      hrcwCategory: null,
    });
    if (match) covered.add(match.id);
  }

  for (const cat of [...new Set(i.swmsCategories)]) {
    const match = i.topics.find((t) => t.hrcwCategory === cat);
    if (match && recentlyRun(match.id)) continue;
    const title = match?.title ?? HRCW_TITLES[cat];
    if (!title) continue;
    out.push({
      reason: 'swms_in_force',
      topicId: match?.id ?? null,
      title,
      because: `An accepted SWMS on this project covers ${cat.replace(/_/g, ' ')} work and no talk on it was held in the last ${RECENT_DAYS} days.`,
      hrcwCategory: cat,
    });
    if (match) covered.add(match.id);
  }

  const rotation = i.topics
    .filter((t) => !covered.has(t.id))
    .map((t) => ({ t, at: i.lastRun.get(t.id) }))
    .filter((x) => x.at === undefined || daysBetween(i.now, x.at) >= STALE_DAYS)
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  for (const { t, at } of rotation)
    out.push({
      reason: at ? 'not_run_recently' : 'never_run',
      topicId: t.id,
      title: t.title,
      because: at
        ? `Last run ${daysBetween(i.now, at)} days ago.`
        : 'In your topic library and not run on this project yet.',
      hrcwCategory: t.hrcwCategory,
    });

  return out.slice(0, i.limit ?? 5);
}
