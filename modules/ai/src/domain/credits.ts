// AI credits (ai/05 §5, X27). One credit ≈ one Ask Nova question; every task has a fixed price so customers
// see predictable numbers and we absorb the variance. Credits are charged to the org that owns the project.
import type { TaskKind } from '@archova/ai-prompts';

/**
 * Fixed credit price per task id. Background work that keeps the product correct (title blocks, embeddings)
 * costs 0 credits: it is covered by the plan and never stopped by the allowance (ai/05 §4).
 * Every registered prompt must have a price here (checked when the gateway starts).
 */
export const TASK_CREDITS: Readonly<Record<string, number>> = {
  'drawing.titleblock': 0,
  'embed.document': 0,
  'embed.query': 0,
  'qa.rewrite': 0,
  'qa.answer': 1,
  // One draft reads ~30 passages and writes a full induction: about three questions' worth (ai/12 §2).
  'induction.draft': 3,
  'rfi.draft': 1,
  'diary.summary': 0.5,
  'defect.tag': 0.1,
  'minutes.extract': 1.5,
};

export function creditsFor(
  task: string,
  prices: Readonly<Record<string, number>> = TASK_CREDITS,
): number {
  const credits = prices[task];
  if (credits === undefined) throw new Error(`No credit price for AI task ${task} (ai/05 §5)`);
  return credits;
}

export interface AllowanceInput {
  /** Monthly allowance from the plan (`limit.ai_credits`); null means unlimited. */
  planAllowance: number | null;
  /** Lower cap the org admin chose (`ai_org_settings.monthly_credit_cap`); null means none. */
  orgCap: number | null;
  /** Credits used so far this month. */
  used: number;
}

/** The allowance that applies: the lower of the plan's and the admin's cap. */
export function effectiveAllowance(a: Pick<AllowanceInput, 'planAllowance' | 'orgCap'>) {
  if (a.planAllowance === null) return a.orgCap;
  if (a.orgCap === null) return a.planAllowance;
  return Math.min(a.planAllowance, a.orgCap);
}

export type BudgetDecision =
  | { allow: true; remaining: number | null; warn: boolean }
  | { allow: false; reason: 'allowance_used' };

/**
 * Interactive work stops at 100% of the allowance (top-ups come with billing); background work always runs.
 * `warn` is true from 80%, when the org admin is notified (ai/05 §4).
 */
export function decideBudget(kind: TaskKind, credits: number, a: AllowanceInput): BudgetDecision {
  const allowance = effectiveAllowance(a);
  if (allowance === null) return { allow: true, remaining: null, warn: false };
  const remaining = allowance - a.used;
  if (kind === 'interactive' && credits > 0 && remaining < credits) {
    return { allow: false, reason: 'allowance_used' };
  }
  return {
    allow: true,
    remaining: Math.max(0, remaining - credits),
    warn: a.used + credits >= allowance * 0.8,
  };
}
