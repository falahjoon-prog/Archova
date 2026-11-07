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
  'qa.rerank': 0,
  'qa.answer': 1,
  // One draft reads ~30 passages and writes a full induction: about three questions' worth (ai/12 §2).
  'induction.draft': 3,
  // A refresh redrafts the few sections a changed document touched: about one question's worth. Priya to confirm.
  'induction.refresh': 1,
  // A worker's question during an induction, charged to the builder's org. Priced like background work until Priya
  // sets the price and the per-induction daily cap (ai/12 §5).
  'induction.ask': 0.25,
  // Safety translation (F26, ai/12 I4): per slide or quiz question, once per version and language (cached), so a
  // 20-slide induction costs about 5 credits per language. The back-translation check is covered. Priya to confirm.
  'translation.translate': 0.25,
  'translation.check': 0,
  'rfi.draft': 1,
  // F20: a whole SWMS at the standard tier, longer than an RFI draft; about three questions' worth. Priya to confirm.
  'swms.draft': 3,
  // F3: the response to an RFI that exists, drafted from its thread and the project documents; like a new draft.
  'rfi.answer': 1,
  // F21: one sheet's text changes put into words; cached per revision pair, so opening it again is free. Priya to
  // confirm.
  'drawing.compare': 0.5,
  // F21 vision pass: up to 12 small pictures of the places the linework changed; with the text compare, a revision
  // pair costs one credit. Cached with it. Priya to confirm.
  'drawing.compare_visual': 0.5,
  // Nova Esti (ai/10 E1): one sheet image in, the found items out; one run per target on a sheet. Priya to confirm.
  'takeoff.detect': 1,
  // Nova on the budget: the findings and totals in, a short read and options out, standard tier. Priya to confirm.
  'budget.review': 0.5,
  'diary.summary': 0.5,
  // F4: a week's worth of facts in, a longer report out: about two daily summaries. Priya to confirm.
  'diary.weekly': 1,
  'defect.tag': 0.1,
  // F35: one site photo at the standard tier, a short list of signals out. Priya to confirm.
  'safety.hazard_scan': 0.25,
  // One site photo at the fast tier, area, trade and a few tags out. Priya to confirm.
  'photo.tag': 0.1,
  // F31: one suggestion per import file, however many columns. Priya to confirm.
  'import.mapping': 0.25,
  // F22: one quote PDF read into lines and notes; about a meeting minutes run (ai/10 §5). Priya to confirm.
  'quote.read': 1.5,
  // Nova: one turn of negotiation help on a confirmed quote; about a diary summary's worth of output. Priya to confirm.
  'quote.negotiate': 0.5,
  // Nova: one turn of discussion on a slow cost code's labor productivity; same size as a quote negotiation turn. Priya to confirm.
  'labor.productivity': 0.5,
  // F34: a whole contract read at the advanced tier; the design's estimate (design/09 CR1). Priya to confirm.
  'contract.review': 40,
  // F34 Ask the contract: the pages and one question at the standard tier, a short cited answer out. Priya to confirm.
  'contract.ask': 2,
  // F34 Compare contracts: two contracts' pages and a list of cited differences out, standard tier. Priya to confirm.
  'contract.compare': 5,
  // Nova listening: one short spoken question turned into text. Priya to confirm.
  'speech.transcribe': 0.1,
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
  /** Extra credits staff granted for this month; they lift the plan's allowance and the admin's cap alike. */
  granted?: number;
}

/**
 * The allowance that applies: the lower of the plan's and the admin's cap, plus this month's grants. An unlimited
 * allowance with no cap stays unlimited (null).
 */
export function effectiveAllowance(
  a: Pick<AllowanceInput, 'planAllowance' | 'orgCap' | 'granted'>,
) {
  const base =
    a.planAllowance === null
      ? a.orgCap
      : a.orgCap === null
        ? a.planAllowance
        : Math.min(a.planAllowance, a.orgCap);
  return base === null ? null : base + (a.granted ?? 0);
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
