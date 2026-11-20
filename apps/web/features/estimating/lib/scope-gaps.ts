// Scope-gap check on an estimate: a checklist of what usually travels with the work already priced, so a missing
// reinforcement, waterproofing or preliminaries line is noticed before the estimate is issued. Plain keyword rules on
// line and section descriptions, not a model: it only ever asks a question, never adds a line or a price.

export interface GapRule {
  id: string;
  /** Any of these in an estimate line or section makes the rule apply. */
  when: RegExp;
  /** None of these anywhere in the estimate and the item is flagged. */
  expect: RegExp;
  /** What to look for, shown to the estimator. */
  missing: string;
  because: string;
}

export const GAP_RULES: readonly GapRule[] = [
  {
    id: 'slab-reo',
    when: /\b(slab|footing|raft)/i,
    expect: /\b(reo|reinforc|mesh|rebar|bar chairs?)/i,
    missing: 'Reinforcement',
    because: 'Concrete slabs and footings are priced, but no reinforcement is.',
  },
  {
    id: 'slab-formwork',
    when: /\b(slab|footing|raft|concrete)/i,
    expect: /\b(formwork|form work|boxing|edge form)/i,
    missing: 'Formwork',
    because: 'Concrete is priced with no formwork or boxing.',
  },
  {
    id: 'slab-membrane',
    when: /\bslab\b/i,
    expect: /\b(membrane|vapou?r barrier|termite|poly)/i,
    missing: 'Under-slab membrane / termite barrier',
    because: 'A slab is priced with no membrane or termite barrier.',
  },
  {
    id: 'footing-excavation',
    when: /\b(footing|slab|pier)/i,
    expect: /\b(excavat|earthwork|cut|trench|site clear)/i,
    missing: 'Excavation and site cut',
    because: 'Footings or a slab are priced, but no excavation is.',
  },
  {
    id: 'frame-bracing',
    when: /\b(frame|framing|truss|stud|timber)/i,
    expect: /\b(brac|tie.?down|strap|connector)/i,
    missing: 'Bracing and tie-downs',
    because: 'Framing is priced with no bracing or tie-downs.',
  },
  {
    id: 'roof-sarking',
    when: /\b(roof|roofing|truss)/i,
    expect: /\b(sarking|anticon|insulation|batts?)/i,
    missing: 'Sarking / roof insulation',
    because: 'Roofing is priced with no sarking or insulation.',
  },
  {
    id: 'roof-plumbing',
    when: /\b(roof|roofing)/i,
    expect: /\b(gutter|fascia|downpipe|flashing)/i,
    missing: 'Gutters, fascia and flashings',
    because: 'Roofing is priced with no roof drainage or flashings.',
  },
  {
    id: 'wet-area',
    when: /\b(tile|tiling|bathroom|ensuite|laundry|shower|wet area)/i,
    expect: /\b(waterproof|membrane)/i,
    missing: 'Waterproofing',
    because: 'Wet-area work is priced with no waterproofing.',
  },
  {
    id: 'lining-finish',
    when: /\b(plasterboard|gyprock|lining)/i,
    expect: /\b(paint|cornice|set|stopping|render)/i,
    missing: 'Cornice, set and paint',
    because: 'Wall lining is priced with no finishing.',
  },
  {
    id: 'openings-flashing',
    when: /\b(window|door)/i,
    expect: /\b(flashing|sill|seal|architrave|trim)/i,
    missing: 'Flashings and trims for openings',
    because: 'Windows or doors are priced with no flashing or trims.',
  },
  {
    id: 'hot-water',
    when: /\b(plumb|sanitary|fixtures?)/i,
    expect: /\b(hot water|hws|water heater)/i,
    missing: 'Hot water system',
    because: 'Plumbing is priced with no hot water system.',
  },
  {
    id: 'switchboard',
    when: /\b(electric|power|gpo|lighting|wiring)/i,
    expect: /\b(switchboard|meter box|smoke alarm)/i,
    missing: 'Switchboard and smoke alarms',
    because: 'Electrical is priced with no switchboard or smoke alarms.',
  },
  {
    id: 'preliminaries',
    when: /./,
    expect:
      /\b(prelim|permit|site (set.?up|establishment|office)|toilet|fencing|insurance|supervis|skip bin)/i,
    missing: 'Preliminaries (permits, site set-up, supervision, insurance)',
    because: 'No preliminaries are priced.',
  },
];

export interface Gap {
  id: string;
  missing: string;
  because: string;
}

/** What an estimate probably leaves out, given the descriptions already on it. Empty when there are no lines. */
export function findScopeGaps(descriptions: readonly string[]): Gap[] {
  const text = descriptions.join('\n');
  if (!text.trim()) return [];
  return GAP_RULES.filter((r) => r.when.test(text) && !r.expect.test(text)).map(
    ({ id, missing, because }) => ({ id, missing, because }),
  );
}
