// Project home insights: fixed rules that turn a project's own counts into a short, ranked list of things worth a
// look. Pure, no IO. Every sentence and figure comes from code, never a model, so a person can trust the list and Nova
// only discusses it (ai `insights.discuss`); it never changes any data.
import type { BudgetSummary, ProjectCounts, ToolCounts } from './report';

export const INSIGHT_KINDS = [
  'budget',
  'programme',
  'rfis',
  'defects',
  'submittals',
  'variations',
  'claims',
  'incidents',
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];
export const INSIGHT_SEVERITIES = ['high', 'medium', 'low'] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export interface Insight {
  /** Stable per kind, so a follow-up question can name the one it is about. */
  id: InsightKind;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** The plain figures behind the sentence; Nova may cite only these. */
  facts: string[];
}

export interface SlipInput {
  restricted: boolean;
  hasProgramme: boolean;
  lateCount: number;
  worst: readonly { wbs: string | null; name: string; daysLate: number }[];
}

export interface InsightInput {
  counts: ProjectCounts;
  budget: BudgetSummary;
  slip: SlipInput;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whole dollars with thousands separators: "$12,400". Cents are never shown on a summary line. */
export function dollars(cents: number): string {
  const abs = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? '-' : ''}$${abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

type CountKind = Exclude<InsightKind, 'budget' | 'programme'>;

const TOOL_LABEL: Record<CountKind, { one: string; many: string; verb: string }> = {
  rfis: { one: 'RFI', many: 'RFIs', verb: 'past their due date' },
  defects: { one: 'defect', many: 'defects', verb: 'open past their due date' },
  submittals: { one: 'submittal', many: 'submittals', verb: 'waiting past their due date' },
  variations: { one: 'variation', many: 'variations', verb: 'unresolved past their due date' },
  claims: { one: 'payment claim', many: 'payment claims', verb: 'past their due date' },
  incidents: { one: 'incident', many: 'incidents', verb: 'still open past their due date' },
};

function overdueInsight(
  kind: CountKind,
  c: ToolCounts,
  high: number,
  medium: number,
): Insight | null {
  if (c.restricted || c.overdue === 0) return null;
  const label = TOOL_LABEL[kind];
  const severity: InsightSeverity =
    c.overdue >= high ? 'high' : c.overdue >= medium ? 'medium' : 'low';
  return {
    id: kind,
    kind,
    severity,
    title: `${plural(c.overdue, label.one, label.many)} ${label.verb}`,
    detail: `${c.open} ${label.many} are open on this project; ${c.overdue} of them ${c.overdue === 1 ? 'is' : 'are'} overdue.`,
    facts: [`Open ${label.many}: ${c.open}`, `Overdue ${label.many}: ${c.overdue}`],
  };
}

export function budgetInsight(b: BudgetSummary): Insight | null {
  if (b.restricted || !b.hasBudget) return null;
  const over = b.varianceCents < 0;
  if (!over && b.overBudgetCodes === 0) return null;
  const pct = b.revisedCents > 0 ? Math.abs(b.varianceCents) / b.revisedCents : 0;
  const severity: InsightSeverity = !over ? 'low' : pct >= 0.05 ? 'high' : 'medium';
  const facts = [
    `Revised budget: ${dollars(b.revisedCents)}`,
    `Forecast final cost: ${dollars(b.forecastFinalCents)}`,
    `Cost codes forecast over their budget: ${b.overBudgetCodes}`,
  ];
  if (over) facts.push(`Forecast over budget by: ${dollars(-b.varianceCents)}`);
  return {
    id: 'budget',
    kind: 'budget',
    severity,
    title: over
      ? `Forecast is ${dollars(-b.varianceCents)} over budget`
      : `${plural(b.overBudgetCodes, 'cost code')} forecast over budget`,
    detail: over
      ? `The forecast final cost is ${dollars(b.forecastFinalCents)} against a revised budget of ${dollars(b.revisedCents)}, with ${plural(b.overBudgetCodes, 'cost code')} forecast over.`
      : `The project as a whole is within budget, but ${plural(b.overBudgetCodes, 'cost code')} ${b.overBudgetCodes === 1 ? 'is' : 'are'} forecast over their own budget.`,
    facts,
  };
}

export function programmeInsight(s: SlipInput): Insight | null {
  if (s.restricted || !s.hasProgramme || s.lateCount === 0) return null;
  const worst = s.worst[0];
  const days = worst?.daysLate ?? 0;
  const severity: InsightSeverity =
    days >= 14 || s.lateCount >= 5 ? 'high' : days >= 5 ? 'medium' : 'low';
  const facts = [`Tasks past their planned finish: ${s.lateCount}`];
  for (const w of s.worst.slice(0, 3))
    facts.push(`${w.wbs ? `${w.wbs} ` : ''}${w.name} is ${plural(w.daysLate, 'day')} late`);
  return {
    id: 'programme',
    kind: 'programme',
    severity,
    title: `${plural(s.lateCount, 'programme task')} past the planned finish`,
    detail: worst
      ? `The furthest behind is ${worst.wbs ? `${worst.wbs} ` : ''}${worst.name}, ${plural(worst.daysLate, 'day')} late.`
      : 'These tasks are not yet complete.',
    facts,
  };
}

const RANK: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Worst first, then in a fixed kind order so the same data always reads the same way. */
export function buildInsights(input: InsightInput): Insight[] {
  const c = input.counts;
  const all = [
    budgetInsight(input.budget),
    programmeInsight(input.slip),
    overdueInsight('rfis', c.rfis, 5, 2),
    overdueInsight('defects', c.defects, 10, 4),
    overdueInsight('submittals', c.submittals, 5, 2),
    overdueInsight('variations', c.variations, 3, 1),
    overdueInsight('claims', c.claims, 2, 1),
    overdueInsight('incidents', c.incidents, 2, 1),
  ].filter((i): i is Insight => i !== null);
  return all.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      INSIGHT_KINDS.indexOf(a.kind) - INSIGHT_KINDS.indexOf(b.kind),
  );
}
