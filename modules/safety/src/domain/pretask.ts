import { swmsLabel } from './swms';

// Pre-task plans (take-5 style): the rules in one place. Nothing here calls a model. Nova's hazard suggestions are plain
// rules over the linked SWMS and earlier plans on the project; the crew decides what goes on the plan.

export const RISK_LEVELS = ['low', 'medium', 'high', 'extreme'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const PRETASK_STATUSES = ['open', 'closed'] as const;
export type PretaskStatus = (typeof PRETASK_STATUSES)[number];

export type InductionState =
  'current' | 'not_inducted' | 'needs_reinduction' | 'expired' | 'unknown';

export interface PretaskHazard {
  hazard: string;
  riskBefore: RiskLevel;
  controls: string;
  riskAfter: RiskLevel;
}

export const pretaskLabel = (n: number) => `PTP-${String(n).padStart(4, '0')}`;

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, extreme: 3 };

/** A plan can be closed once every hazard has controls, none is still extreme, and the crew has all signed. */
export function closeBlockers(
  hazards: PretaskHazard[],
  crew: { signedAt: Date | null }[],
): string[] {
  const out: string[] = [];
  if (hazards.length === 0) out.push('List at least one hazard for this task.');
  for (const h of hazards) {
    if (h.controls.trim() === '') out.push(`Say how you will control "${h.hazard}".`);
    if (h.riskAfter === 'extreme')
      out.push(
        `"${h.hazard}" is still extreme risk after controls. Do not start until it is lower.`,
      );
    else if (RANK[h.riskAfter] > RANK[h.riskBefore])
      out.push(`"${h.hazard}" has a higher risk after controls than before. Check the ratings.`);
  }
  if (crew.length === 0) out.push('Add the people doing the task.');
  else {
    const unsigned = crew.filter((c) => c.signedAt === null).length;
    if (unsigned > 0)
      out.push(
        `${unsigned} ${unsigned === 1 ? 'person has' : 'people have'} not signed on. Sign, or remove them.`,
      );
  }
  return out;
}

export type PretaskWarning =
  | { code: 'swms_not_accepted'; message: string }
  | { code: 'swms_expired'; message: string }
  | { code: 'induction'; personName: string; state: InductionState; message: string }
  | { code: 'swms_not_read'; personName: string; message: string };

const INDUCTION_TEXT: Record<Exclude<InductionState, 'current' | 'unknown'>, string> = {
  not_inducted: 'has not done the site induction',
  needs_reinduction: 'needs to redo the site induction (a newer version is out)',
  expired: 'has an expired site induction',
};

/** Things a supervisor should look at. They never block a plan; people decide. */
export function planWarnings(input: {
  swms: { number: number; status: string; expired: boolean } | null;
  crew: {
    personName: string;
    inductionStatus: InductionState | null;
    /** null when the person has no login to acknowledge with, or no accepted SWMS is linked. */
    swmsRead: boolean | null;
  }[];
}): PretaskWarning[] {
  const out: PretaskWarning[] = [];
  const s = input.swms;
  if (s && s.status !== 'accepted')
    out.push({
      code: 'swms_not_accepted',
      message: `The linked SWMS is not accepted yet (${s.status.replace(/_/g, ' ')}).`,
    });
  else if (s?.expired)
    out.push({ code: 'swms_expired', message: 'The linked SWMS has passed its expiry date.' });
  for (const c of input.crew) {
    const st = c.inductionStatus;
    if (st && st !== 'current' && st !== 'unknown')
      out.push({
        code: 'induction',
        personName: c.personName,
        state: st,
        message: `${c.personName} ${INDUCTION_TEXT[st]}.`,
      });
    if (c.swmsRead === false)
      out.push({
        code: 'swms_not_read',
        personName: c.personName,
        message: `${c.personName} has not read the linked SWMS.`,
      });
  }
  return out;
}

// --- Nova hazard suggestions (rules) -------------------------------------------------------------------------------

export type HazardReason = 'from_swms' | 'recurring' | 'recent_incident';

export interface HazardSuggestion {
  reason: HazardReason;
  hazard: string;
  controls: string;
  riskBefore: RiskLevel;
  because: string;
}

export const hazardKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Splits free text of hazards ("- falls from the edge\n- plant") into lines. */
export function hazardLines(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n|;/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length >= 3 && l.length <= 200);
}

const INCIDENT_HAZARDS: Record<string, { hazard: string; controls: string }> = {
  injury: {
    hazard: 'Injury from the task being done today',
    controls: 'Check the area before starting. Report any injury or near miss straight away.',
  },
  near_miss: {
    hazard: 'Repeat of a recent near miss',
    controls: 'Talk through what happened last time and what has changed.',
  },
  dangerous_occurrence: {
    hazard: 'Dangerous incident repeating',
    controls: 'Confirm exclusion zones and who has authority to stop work.',
  },
  property_damage: {
    hazard: 'Damage to plant, materials or finished work',
    controls: 'Walk the work area. Protect finished surfaces and mark the path of plant.',
  },
};

export const RECURRING_WINDOW_DAYS = 14;
export const RECURRING_MIN_PLANS = 2;

export interface SuggestInput {
  swms: {
    number: number;
    hazardsAndRisks?: string;
    controls: string[];
  } | null;
  /** Hazards on other plans on the project in the recurring window, newest plan first. */
  recentPlans: { workDate: string; hazards: PretaskHazard[] }[];
  recentIncidentTypes: { type: string; count: number }[];
  /** Hazards already on the plan, so nothing is suggested twice. */
  current: PretaskHazard[];
  limit?: number;
}

export function suggestHazards(i: SuggestInput): HazardSuggestion[] {
  const have = new Set(i.current.map((h) => hazardKey(h.hazard)));
  const out: HazardSuggestion[] = [];
  const add = (s: HazardSuggestion) => {
    const k = hazardKey(s.hazard);
    if (have.has(k)) return;
    have.add(k);
    out.push(s);
  };

  // Hazards that keep coming up come first: they are what the crew is likely to see again today.
  const seen = new Map<string, { n: number; latest: PretaskHazard }>();
  for (const p of i.recentPlans)
    for (const h of new Map(p.hazards.map((x) => [hazardKey(x.hazard), x])).values()) {
      const k = hazardKey(h.hazard);
      const prev = seen.get(k);
      seen.set(k, { n: (prev?.n ?? 0) + 1, latest: prev?.latest ?? h });
    }
  for (const { n, latest } of [...seen.values()].sort((a, b) => b.n - a.n))
    if (n >= RECURRING_MIN_PLANS)
      add({
        reason: 'recurring',
        hazard: latest.hazard,
        controls: latest.controls,
        riskBefore: latest.riskBefore,
        because: `Raised on ${n} plans in the last ${RECURRING_WINDOW_DAYS} days. Check the controls still hold.`,
      });

  if (i.swms) {
    const controls = i.swms.controls.filter((c) => c.trim() !== '').join('; ');
    for (const h of hazardLines(i.swms.hazardsAndRisks))
      add({
        reason: 'from_swms',
        hazard: h,
        controls,
        riskBefore: 'high',
        because: `Listed in ${swmsLabel(i.swms.number)}.`,
      });
  }

  for (const inc of i.recentIncidentTypes) {
    const t = INCIDENT_HAZARDS[inc.type];
    if (t)
      add({
        reason: 'recent_incident',
        hazard: t.hazard,
        controls: t.controls,
        riskBefore: 'medium',
        because: `${inc.count} ${inc.type.replace(/_/g, ' ')} ${inc.count === 1 ? 'report' : 'reports'} on this project in the last 30 days.`,
      });
  }
  return out.slice(0, i.limit ?? 8);
}
