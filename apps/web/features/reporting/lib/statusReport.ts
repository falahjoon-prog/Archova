import type { TonedBar } from '@archova/ui';
import type { PortfolioProject } from './types';

/** All projects, or just the chosen one. An unknown id (a project closed since) falls back to all. */
export function scopeProjects(
  projects: readonly PortfolioProject[],
  projectId: string,
): PortfolioProject[] {
  if (projectId === 'all') return [...projects];
  const one = projects.filter((p) => p.id === projectId);
  return one.length > 0 ? one : [...projects];
}

const cents = (amount: string) => Math.round(Number(amount) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

const hasBudget = (p: PortfolioProject) => p.budget.hasBudget && !p.budget.restricted;

export interface CostRollup {
  /** Projects with a budget the caller can see; the figures below cover only these. */
  projects: number;
  revised: string;
  forecastFinal: string;
  spent: string;
  /** Revised budget less forecast final cost; negative is over. */
  overUnder: string;
  /** Forecast final cost as a share of the revised budget, null when there is no budget. */
  forecastOfBudgetPct: number | null;
  /** Spent so far as a share of the forecast final cost. */
  spentOfForecastPct: number | null;
}

export function costRollup(projects: readonly PortfolioProject[]): CostRollup {
  const rows = projects.filter(hasBudget);
  const sum = (pick: (p: PortfolioProject) => string) =>
    rows.reduce((n, p) => n + cents(pick(p)), 0);
  const revised = sum((p) => p.budget.revised);
  const forecast = sum((p) => p.budget.forecastFinal);
  const spent = sum((p) => p.budget.spent);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    projects: rows.length,
    revised: fromCents(revised),
    forecastFinal: fromCents(forecast),
    spent: fromCents(spent),
    overUnder: fromCents(revised - forecast),
    forecastOfBudgetPct: pct(forecast, revised),
    spentOfForecastPct: pct(spent, forecast),
  };
}

export interface StatusCount {
  onBudgetOnSchedule: number;
  overBudgetOnSchedule: number;
  onBudgetOffSchedule: number;
  overBudgetOffSchedule: number;
  /** No budget, or no access to the budget or programme, so the project cannot be placed. */
  unknown: number;
}

/**
 * Budget (forecast within the revised budget) against schedule (nothing late on the programme). A project with no
 * visible budget or no visible programme cannot be placed and is counted as unknown, never guessed.
 */
export function statusCount(projects: readonly PortfolioProject[]): StatusCount {
  const out: StatusCount = {
    onBudgetOnSchedule: 0,
    overBudgetOnSchedule: 0,
    onBudgetOffSchedule: 0,
    overBudgetOffSchedule: 0,
    unknown: 0,
  };
  for (const p of projects) {
    if (!hasBudget(p) || p.programme.restricted) {
      out.unknown += 1;
      continue;
    }
    const over = p.budget.variance.startsWith('-');
    const off = p.programme.overdue > 0;
    if (over && off) out.overBudgetOffSchedule += 1;
    else if (over) out.overBudgetOnSchedule += 1;
    else if (off) out.onBudgetOffSchedule += 1;
    else out.onBudgetOnSchedule += 1;
  }
  return out;
}

export function statusBars(c: StatusCount): TonedBar[] {
  return [
    { label: 'On budget, on schedule', value: c.onBudgetOnSchedule, tone: 'success' },
    { label: 'Over budget, on schedule', value: c.overBudgetOnSchedule, tone: 'warning' },
    { label: 'On budget, off schedule', value: c.onBudgetOffSchedule, tone: 'warning' },
    { label: 'Over budget, off schedule', value: c.overBudgetOffSchedule, tone: 'danger' },
    ...(c.unknown > 0
      ? [{ label: 'Not enough data', value: c.unknown, tone: 'neutral' as const }]
      : []),
  ];
}

export interface ScheduleSummary {
  /** Projects whose programme the caller can read. */
  projects: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  late: number;
  /** Average days late over the late activities, null when none are late. */
  averageDaysLate: number | null;
}

export function scheduleSummary(projects: readonly PortfolioProject[]): ScheduleSummary {
  const rows = projects.filter((p) => !p.programme.restricted);
  const sum = (pick: (p: PortfolioProject) => number) => rows.reduce((n, p) => n + pick(p), 0);
  const notStarted = sum((p) => p.programme.notStarted);
  const completed = sum((p) => p.programme.completed);
  const open = sum((p) => p.programme.open);
  const late = sum((p) => p.programme.overdue);
  const lateDays = sum((p) => p.programme.lateDays);
  return {
    projects: rows.length,
    notStarted,
    inProgress: Math.max(0, open - notStarted),
    completed,
    late,
    averageDaysLate: late > 0 ? Math.round((lateDays / late) * 10) / 10 : null,
  };
}
