// Subcontractor safety scorecard (HammerTech-style). Pure, no IO. A company starts at 100 and loses points for
// incidents, overdue corrective actions, SWMS problems, site inductions that were not current when a pre-task
// plan was signed, and unresolved safety observations. The score is a prompt for a person to look, never a ban.

import type { Severity } from './incident';

export const RATINGS = ['good', 'watch', 'elevated', 'high'] as const;
export type Rating = (typeof RATINGS)[number];
export const TRENDS = ['improving', 'steady', 'worsening'] as const;
export type Trend = (typeof TRENDS)[number];

export interface ScorecardInputs {
  incidents: Array<{
    occurredAt: Date;
    severity: Severity;
    isNotifiable: boolean;
    injured: boolean;
    projectId: string;
  }>;
  actions: { total: number; overdueOpen: number };
  swms: { total: number; rejected: number; expired: number };
  inductions: { signed: number; notCurrent: number };
  findings: { raised: number; overdueOpen: number };
}

export interface ScorecardComponent {
  key: 'incidents' | 'actions' | 'swms' | 'inductions' | 'findings';
  label: string;
  /** Points lost, never more than `max`. */
  lost: number;
  max: number;
  detail: string;
}

export interface Scorecard {
  score: number;
  rating: Rating;
  trend: Trend;
  components: ScorecardComponent[];
  /** Plain-language reasons a person should look first. Empty when there is nothing to flag. */
  flags: string[];
  counts: {
    incidents12m: number;
    incidents90d: number;
    notifiable12m: number;
    projects: number;
    overdueActions: number;
  };
}

const SEVERITY_POINTS: Record<Severity, number> = { low: 2, medium: 5, high: 10, critical: 20 };
const DAY = 86_400_000;

export function incidentPoints(i: ScorecardInputs['incidents'][number]): number {
  return SEVERITY_POINTS[i.severity] * (i.injured ? 1.5 : 1) + (i.isNotifiable ? 10 : 0);
}

export function ratingFor(score: number): Rating {
  if (score >= 85) return 'good';
  if (score >= 70) return 'watch';
  if (score >= 50) return 'elevated';
  return 'high';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (n: number, max: number) => Math.min(max, Math.round(n));

export function buildScorecard(input: ScorecardInputs, now: Date): Scorecard {
  const since12 = now.getTime() - 365 * DAY;
  const recentFrom = now.getTime() - 90 * DAY;
  const priorFrom = now.getTime() - 180 * DAY;
  const inc = input.incidents.filter((i) => i.occurredAt.getTime() >= since12);
  const recent = inc.filter((i) => i.occurredAt.getTime() >= recentFrom);
  const prior = inc.filter(
    (i) => i.occurredAt.getTime() >= priorFrom && i.occurredAt.getTime() < recentFrom,
  );
  const sum = (l: typeof inc) => l.reduce((n, i) => n + incidentPoints(i), 0);
  const recentPts = sum(recent);
  const priorPts = sum(prior);
  const notifiable = inc.filter((i) => i.isNotifiable).length;

  // Older incidents count for less: full weight in the last 90 days, half after that.
  const weighted = recentPts + (sum(inc) - recentPts) * 0.5;
  const inductionRate =
    input.inductions.signed >= 3 ? input.inductions.notCurrent / input.inductions.signed : 0;

  const components: ScorecardComponent[] = [
    {
      key: 'incidents',
      label: 'Incidents (12 months)',
      max: 40,
      lost: cap(weighted, 40),
      detail: inc.length
        ? `${plural(inc.length, 'incident')}, ${recent.length} in the last 90 days${notifiable ? `, ${notifiable} notifiable` : ''}`
        : 'No incidents involving this company',
    },
    {
      key: 'actions',
      label: 'Corrective actions',
      max: 20,
      lost: cap(input.actions.overdueOpen * 5, 20),
      detail: input.actions.total
        ? `${input.actions.overdueOpen} overdue of ${input.actions.total}`
        : 'No corrective actions assigned',
    },
    {
      key: 'swms',
      label: 'SWMS',
      max: 10,
      lost: cap((input.swms.rejected + input.swms.expired) * 3, 10),
      detail: input.swms.total
        ? `${input.swms.rejected} rejected, ${input.swms.expired} expired of ${input.swms.total}`
        : 'No SWMS submitted',
    },
    {
      key: 'inductions',
      label: 'Induction compliance',
      max: 15,
      lost: cap(inductionRate * 15, 15),
      detail: input.inductions.signed
        ? `${input.inductions.notCurrent} of ${input.inductions.signed} sign-ons without a current induction`
        : 'No pre-task plan sign-ons yet',
    },
    {
      key: 'findings',
      label: 'Safety observations',
      max: 15,
      lost: cap(input.findings.overdueOpen * 3 + Math.max(0, input.findings.raised - 3) * 0.5, 15),
      detail: input.findings.raised
        ? `${input.findings.raised} raised, ${input.findings.overdueOpen} overdue`
        : 'No safety observations raised',
    },
  ];
  const score = Math.max(0, 100 - components.reduce((n, c) => n + c.lost, 0));
  const rating = ratingFor(score);

  let trend: Trend = 'steady';
  if (recentPts > priorPts && recentPts >= 5) trend = 'worsening';
  else if (recentPts < priorPts && priorPts >= 5) trend = 'improving';

  const flags: string[] = [];
  const serious = recent.filter((i) => i.severity === 'high' || i.severity === 'critical').length;
  if (serious > 0) flags.push(`${plural(serious, 'high-severity incident')} in the last 90 days`);
  if (notifiable > 0)
    flags.push(`${plural(notifiable, 'notifiable incident')} in the last 12 months`);
  if (input.actions.overdueOpen > 0)
    flags.push(`${plural(input.actions.overdueOpen, 'overdue corrective action')}`);
  if (inductionRate >= 0.2)
    flags.push(`${Math.round(inductionRate * 100)}% of crew sign-ons had no current induction`);
  if (trend === 'worsening')
    flags.push('Safety performance is getting worse compared with the previous 90 days');
  if (input.swms.rejected + input.swms.expired > 0)
    flags.push(
      `${plural(input.swms.rejected + input.swms.expired, 'SWMS problem')} (rejected or expired)`,
    );

  return {
    score,
    rating,
    trend,
    components,
    flags,
    counts: {
      incidents12m: inc.length,
      incidents90d: recent.length,
      notifiable12m: notifiable,
      projects: new Set(inc.map((i) => i.projectId)).size,
      overdueActions: input.actions.overdueOpen,
    },
  };
}

/** A one-line risk flag for Nova to show before a company is added to a project. Null when there is nothing to say. */
export function riskFlag(name: string, c: Scorecard): string | null {
  if (c.rating === 'good' && c.trend !== 'worsening') return null;
  const why = c.flags.slice(0, 3).join('; ');
  return `${name}: ${c.rating} safety risk (score ${c.score}/100, ${c.trend}).${why ? ` ${why}.` : ''}`;
}
