// SWMS rules (compliance 03 §2–§4, model WHS Regulation r299): the high-risk work codes, what a SWMS must contain
// before it can be accepted, and checks that never block but are shown to the reviewer. Pure, no IO.

export const HRCW_CATEGORIES = [
  'fall_2m',
  'telco_tower',
  'demolition_load_bearing',
  'demolition_integrity',
  'asbestos',
  'temp_support',
  'confined_space',
  'shaft_trench_tunnel',
  'explosives',
  'pressurised_gas',
  'chemical_fuel_refrigerant',
  'energised_electrical',
  'contaminated_atmosphere',
  'tilt_up_precast',
  'traffic_corridor',
  'mobile_plant',
  'extreme_temperature',
  'drowning',
  'diving',
] as const;
export type HrcwCategory = (typeof HRCW_CATEGORIES)[number];

/** Hierarchy of controls, highest first (model r35–r36). */
export const CONTROL_LEVELS = [
  'eliminate',
  'substitute',
  'isolate',
  'engineer',
  'administrative',
  'ppe',
] as const;
export type ControlLevel = (typeof CONTROL_LEVELS)[number];

export interface SwmsContent {
  workDescription?: string;
  hazardsAndRisks?: string;
  controlMeasures?: { level: ControlLevel; description: string }[];
  /** How the controls will be implemented, monitored and reviewed. */
  implementation?: string;
  /** The circumstances at this workplace: location, plant, adjacent trades, access. */
  siteSpecific?: string;
  /** True on projects of $250,000 or more (Vic $350,000), where the WHS management plan must be taken into account. */
  whsPlanApplies?: boolean;
  whsPlanConsidered?: string;
  /** For falls over 2 m with only administrative or PPE controls: every control that was considered. */
  fallControlsConsidered?: string;
  responsiblePeople?: string;
  reviewDate?: string;
}

export interface SwmsGap {
  /** The row in compliance 03 §3. Item 7 (understandable) is the reviewer's confirmation, not a field. */
  item: 1 | 2 | 3 | 4 | 5 | 6 | 8;
  field: string;
  message: string;
}

const blank = (s: string | undefined) => !s || s.trim() === '';

/** What is still missing for the SWMS to be accepted. An empty list means every required item is present. */
export function swmsGaps(categories: readonly string[], c: SwmsContent): SwmsGap[] {
  const gaps: SwmsGap[] = [];
  if (categories.length === 0)
    gaps.push({
      item: 1,
      field: 'highRiskWorkCategories',
      message: 'Name the high-risk work this covers.',
    });
  if (blank(c.hazardsAndRisks))
    gaps.push({
      item: 2,
      field: 'content/hazardsAndRisks',
      message: 'State the hazards and risks of the work.',
    });
  const controls = (c.controlMeasures ?? []).filter((m) => !blank(m.description));
  if (controls.length === 0)
    gaps.push({
      item: 3,
      field: 'content/controlMeasures',
      message: 'Describe the control measures.',
    });
  if (blank(c.implementation))
    gaps.push({
      item: 4,
      field: 'content/implementation',
      message: 'Say how the controls will be implemented, monitored and reviewed.',
    });
  if (blank(c.siteSpecific))
    gaps.push({
      item: 5,
      field: 'content/siteSpecific',
      message: 'Describe the circumstances at this site.',
    });
  if (c.whsPlanApplies && blank(c.whsPlanConsidered))
    gaps.push({
      item: 6,
      field: 'content/whsPlanConsidered',
      message: 'Say how the WHS management plan was taken into account.',
    });
  if (
    categories.includes('fall_2m') &&
    controls.length > 0 &&
    controls.every((m) => m.level === 'administrative' || m.level === 'ppe') &&
    blank(c.fallControlsConsidered)
  )
    gaps.push({
      item: 8,
      field: 'content/fallControlsConsidered',
      message:
        'For a fall over 2 m with only administrative or PPE controls, record every control considered.',
    });
  return gaps;
}

export interface SwmsAdvisory {
  code: 'only_admin_or_ppe' | 'silica' | 'asbestos_register';
  message: string;
}

const SILICA =
  /\b(cut(ting)?|chas(e|ing)|grind(ing)?|drill(ing)?|saw(ing)?|polish(ing)?)\b.{0,60}\b(concrete|brick|tile|stone|masonry|paver)/i;

/** Things a reviewer should look at (WorkSafe guidance). They never block acceptance. */
export function swmsAdvisories(categories: readonly string[], c: SwmsContent): SwmsAdvisory[] {
  const out: SwmsAdvisory[] = [];
  const controls = (c.controlMeasures ?? []).filter((m) => !blank(m.description));
  if (
    controls.length > 0 &&
    controls.every((m) => m.level === 'administrative' || m.level === 'ppe')
  )
    out.push({
      code: 'only_admin_or_ppe',
      message:
        'Every control is administrative or PPE. Check whether eliminating, substituting, isolating or engineering the hazard is reasonably practicable.',
    });
  const text = [c.workDescription, c.hazardsAndRisks, ...controls.map((m) => m.description)].join(
    ' ',
  );
  if (SILICA.test(text))
    out.push({
      code: 'silica',
      message:
        'This mentions cutting, grinding or drilling masonry or concrete. Check the crystalline silica risk assessment and control plan.',
    });
  if (categories.includes('asbestos'))
    out.push({
      code: 'asbestos_register',
      message: 'Asbestos work: check the asbestos register and the licensed removalist details.',
    });
  return out;
}

export const SWMS_STATUSES = ['submitted', 'reviewed', 'accepted', 'rejected'] as const;
export type SwmsStatus = (typeof SWMS_STATUSES)[number];
export const SWMS_ACTIONS = ['markReviewed', 'accept', 'reject', 'reopen'] as const;
export type SwmsAction = (typeof SWMS_ACTIONS)[number];

export type SwmsTransition =
  | { ok: true; to: SwmsStatus }
  | { ok: false; code: 'swms.invalid_transition' | 'swms.reason_required' };

export function swmsTransition(
  from: SwmsStatus,
  action: SwmsAction,
  reason: string | null,
): SwmsTransition {
  const open = from === 'submitted' || from === 'reviewed';
  const to: SwmsStatus | null =
    action === 'markReviewed' && from === 'submitted'
      ? 'reviewed'
      : action === 'accept' && open
        ? 'accepted'
        : action === 'reject' && open
          ? 'rejected'
          : action === 'reopen' && from === 'accepted'
            ? 'submitted'
            : null;
  if (!to) return { ok: false, code: 'swms.invalid_transition' };
  if ((action === 'reject' || action === 'reopen') && !reason?.trim())
    return { ok: false, code: 'swms.reason_required' };
  return { ok: true, to };
}

export const swmsLabel = (n: number) => `SWMS-${String(n).padStart(4, '0')}`;

/** A SWMS past its `expires_on` date (a site-local date, compared as text). */
export const isExpired = (expiresOn: string | null, localToday: string) =>
  expiresOn !== null && expiresOn < localToday;
