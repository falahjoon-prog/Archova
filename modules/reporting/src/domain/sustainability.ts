// Company sustainability roll-up: one row per project from the environment module's counts, company totals, and the
// rule-based flags Nova raises across projects. Pure, no IO. The thresholds repeat the environment module's own
// per-project flags so a project's page and the portfolio never disagree.

/** Share of waste (by weight) that should be diverted from landfill. */
export const DIVERSION_TARGET_PERCENT = 80;
/** Below this much waste a diversion rate says little. */
export const DIVERSION_MIN_TONNES = 1;
/** A fall of this many points between the last 30 days and the 30 before is flagged. */
export const DIVERSION_DROP_POINTS = 10;
/** Emissions up this much on the previous 30 days are flagged, off a base of at least `CARBON_MIN_BASE_KG`. */
export const CARBON_RISE_PERCENT = 25;
export const CARBON_MIN_BASE_KG = 1000;

export interface ProjectSustainability {
  restricted: boolean;
  hasPlan: boolean;
  conditions: { nonCompliant: number; overdue: number; compliancePercent: number | null };
  documentsLapsing: number;
  monitoring: { points: number; openBreaches: number; overdue: number };
  waste: {
    totalTonnes: number;
    divertedTonnes: number;
    landfillTonnes: number;
    diversionPercent: number | null;
    last30Tonnes: number;
    last30DivertedTonnes: number;
    last30DiversionPercent: number | null;
    previous30Tonnes: number;
    previous30DivertedTonnes: number;
    previous30DiversionPercent: number | null;
    regulatedWithoutDocket: number;
  };
  carbon: { totalKg: number; last30Kg: number; previous30Kg: number; changePercent: number | null };
}

export type SustainabilityFlagCode =
  | 'breach_open'
  | 'conditions_non_compliant'
  | 'docket_missing'
  | 'diversion_falling'
  | 'diversion_low'
  | 'carbon_rising'
  | 'plan_missing';

export interface SustainabilityFlag {
  code: SustainabilityFlagCode;
  severity: 'info' | 'warning' | 'critical';
  projectId: string;
  projectName: string;
  message: string;
}

export const isDiversionFalling = (s: ProjectSustainability) => {
  const w = s.waste;
  if (w.last30DiversionPercent === null || w.previous30DiversionPercent === null) return false;
  if (w.last30Tonnes < DIVERSION_MIN_TONNES || w.previous30Tonnes < DIVERSION_MIN_TONNES)
    return false;
  return w.previous30DiversionPercent - w.last30DiversionPercent >= DIVERSION_DROP_POINTS;
};

export const isDiversionLow = (s: ProjectSustainability) =>
  s.waste.diversionPercent !== null &&
  s.waste.totalTonnes >= DIVERSION_MIN_TONNES &&
  s.waste.diversionPercent < DIVERSION_TARGET_PERCENT;

export const isCarbonRising = (s: ProjectSustainability) =>
  s.carbon.changePercent !== null &&
  s.carbon.previous30Kg >= CARBON_MIN_BASE_KG &&
  s.carbon.changePercent >= CARBON_RISE_PERCENT;

/** What needs chasing on a project, so the table can be ordered by it. Restricted projects count nothing. */
export function sustainabilityAttention(s: ProjectSustainability): number {
  if (s.restricted) return 0;
  return (
    s.monitoring.openBreaches * 3 +
    s.conditions.nonCompliant * 2 +
    s.waste.regulatedWithoutDocket * 2 +
    s.conditions.overdue +
    s.monitoring.overdue +
    (isDiversionFalling(s) ? 1 : 0) +
    (isDiversionLow(s) ? 1 : 0) +
    (isCarbonRising(s) ? 1 : 0)
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function projectFlags(
  project: { id: string; name: string },
  s: ProjectSustainability,
): SustainabilityFlag[] {
  if (s.restricted) return [];
  const f = (
    code: SustainabilityFlagCode,
    severity: SustainabilityFlag['severity'],
    message: string,
  ): SustainabilityFlag => ({
    code,
    severity,
    projectId: project.id,
    projectName: project.name,
    message,
  });
  const out: SustainabilityFlag[] = [];
  if (s.monitoring.openBreaches > 0)
    out.push(
      f(
        'breach_open',
        'critical',
        `${plural(s.monitoring.openBreaches, 'monitoring breach', 'monitoring breaches')} waiting for a response.`,
      ),
    );
  if (s.conditions.nonCompliant > 0)
    out.push(
      f(
        'conditions_non_compliant',
        'critical',
        `${plural(s.conditions.nonCompliant, 'permit condition')} flagged non-compliant.`,
      ),
    );
  if (s.waste.regulatedWithoutDocket > 0)
    out.push(
      f(
        'docket_missing',
        'critical',
        `${plural(s.waste.regulatedWithoutDocket, 'hazardous or asbestos docket')} without a copy attached.`,
      ),
    );
  if (isDiversionFalling(s))
    out.push(
      f(
        'diversion_falling',
        'warning',
        `Waste diversion fell from ${s.waste.previous30DiversionPercent}% to ${s.waste.last30DiversionPercent}% in the last 30 days.`,
      ),
    );
  else if (isDiversionLow(s))
    out.push(
      f(
        'diversion_low',
        'warning',
        `Only ${s.waste.diversionPercent}% of waste is diverted from landfill, against a target of ${DIVERSION_TARGET_PERCENT}%.`,
      ),
    );
  if (isCarbonRising(s))
    out.push(
      f(
        'carbon_rising',
        'warning',
        `Emissions are up ${s.carbon.changePercent}% on the 30 days before.`,
      ),
    );
  if (!s.hasPlan)
    out.push(f('plan_missing', 'info', 'No Environmental Management Plan is set up.'));
  return out;
}

const RANK = { critical: 0, warning: 1, info: 2 } as const;
/** Most serious first, then by project name, so the top of the list is what to ring about today. */
export const orderFlags = (flags: SustainabilityFlag[]) =>
  [...flags].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.projectName.localeCompare(b.projectName) ||
      a.code.localeCompare(b.code),
  );

export interface SustainabilityTotals {
  projectsCovered: number;
  projectsRestricted: number;
  projectsWithoutPlan: number;
  openBreaches: number;
  nonCompliantConditions: number;
  overdueConditions: number;
  documentsLapsing: number;
  wasteTonnes: number;
  landfillTonnes: number;
  diversionPercent: number | null;
  last30DiversionPercent: number | null;
  previous30DiversionPercent: number | null;
  carbonKg: number;
  carbonLast30Kg: number;
  carbonPrevious30Kg: number;
  carbonChangePercent: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Company totals over the projects the caller could read; restricted projects are left out, not counted as zero. */
export function sustainabilityTotals(rows: ProjectSustainability[]): SustainabilityTotals {
  const open = rows.filter((r) => !r.restricted);
  const sum = (f: (r: ProjectSustainability) => number) => open.reduce((a, r) => a + f(r), 0);
  const wasteTonnes = sum((r) => r.waste.totalTonnes);
  const last30 = sum((r) => r.waste.last30Tonnes);
  const prev30 = sum((r) => r.waste.previous30Tonnes);
  const carbonLast30 = sum((r) => r.carbon.last30Kg);
  const carbonPrev30 = sum((r) => r.carbon.previous30Kg);
  return {
    projectsCovered: open.length,
    projectsRestricted: rows.length - open.length,
    projectsWithoutPlan: open.filter((r) => !r.hasPlan).length,
    openBreaches: sum((r) => r.monitoring.openBreaches),
    nonCompliantConditions: sum((r) => r.conditions.nonCompliant),
    overdueConditions: sum((r) => r.conditions.overdue),
    documentsLapsing: sum((r) => r.documentsLapsing),
    wasteTonnes: round1(wasteTonnes),
    landfillTonnes: round1(sum((r) => r.waste.landfillTonnes)),
    diversionPercent: pct(
      sum((r) => r.waste.divertedTonnes),
      wasteTonnes,
    ),
    last30DiversionPercent: pct(
      sum((r) => r.waste.last30DivertedTonnes),
      last30,
    ),
    previous30DiversionPercent: pct(
      sum((r) => r.waste.previous30DivertedTonnes),
      prev30,
    ),
    carbonKg: round1(sum((r) => r.carbon.totalKg)),
    carbonLast30Kg: round1(carbonLast30),
    carbonPrevious30Kg: round1(carbonPrev30),
    carbonChangePercent:
      carbonPrev30 > 0 ? Math.round(((carbonLast30 - carbonPrev30) / carbonPrev30) * 100) : null,
  };
}
