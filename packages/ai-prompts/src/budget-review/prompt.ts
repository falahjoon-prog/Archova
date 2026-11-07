// Nova on the project budget (ai/10): the builder's project team asks what to make of the budget. Code finds the
// problems (lines over-committed, over-spent, unbudgeted, close to the limit, changed a lot) and works out every
// amount; the model explains them in plain words, helps the person decide and suggests ways to fix each one. It
// never changes a budget, commitment or cost. The input holds cost codes and amounts only: no margin, companies,
// people or notes.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const MAX_REVIEW_FINDINGS = 40;
export const MAX_REVIEW_TURNS = 10;
const Amount = z.string().regex(/^-?\d{1,14}\.\d{2}$/);

export const ReviewFinding = z.object({
  id: z.string().regex(/^[a-z_]{3,20}:[^\s<>"]{1,40}$/),
  kind: z.enum(['over_committed', 'over_spent', 'unbudgeted', 'near_limit', 'large_change']),
  severity: z.enum(['high', 'medium']),
  code: z.string().max(40),
  description: z.string().max(200),
  summary: z.string().max(400),
  figures: z.record(z.string().max(20), Amount),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

export const ReviewTurn = z.object({
  role: z.enum(['user', 'nova']),
  text: z.string().min(1).max(1500),
});
export type ReviewTurn = z.infer<typeof ReviewTurn>;

export const BudgetReviewInput = z.object({
  totals: z.object({ revised: Amount, committed: Amount, actual: Amount }),
  lineCount: z.number().int().min(0),
  locked: z.boolean(),
  findings: z.array(ReviewFinding).max(MAX_REVIEW_FINDINGS),
  history: z.array(ReviewTurn).max(MAX_REVIEW_TURNS),
  /** What the person just asked; empty for an opening read. */
  question: z.string().max(1000),
});
export type BudgetReviewInput = z.infer<typeof BudgetReviewInput>;

export const REVIEW_OPTION_KINDS = [
  'adjust_budget',
  'reallocate',
  'review_commitment',
  'check_costs',
  'raise_variation',
  'get_forecast',
  'no_action',
] as const;
export type ReviewOptionKind = (typeof REVIEW_OPTION_KINDS)[number];

export const BudgetReviewOutput = z.object({
  reply: z.string().min(1).max(1200),
  /** What matters about one finding (or the budget as a whole when findingId is null). */
  points: z
    .array(z.object({ findingId: z.string().max(60).nullable(), text: z.string().min(1).max(300) }))
    .max(8),
  /** Ways to deal with a finding, for the person to pick from; none is done for them. */
  options: z
    .array(
      z.object({
        findingId: z.string().max(60).nullable(),
        kind: z.enum(REVIEW_OPTION_KINDS),
        text: z.string().min(1).max(300),
      }),
    )
    .max(10),
  /** A reason the person could put on a budget adjustment; null unless they asked for one. */
  draftReason: z.string().max(400).nullable(),
});
export type BudgetReviewOutput = z.infer<typeof BudgetReviewOutput>;

const SYSTEM = `You are Nova, the Archova assistant, helping a builder's project team read the budget of an Australian construction project. You are not an accountant and not a decision maker.

${UNTRUSTED_CONTENT_RULE}

Rules:
- You explain, suggest and help the person choose. You never change a budget, commitment or cost, and never say you have. Every option is something the person does themselves.
- The findings were found by code, and every amount is in the input. Use only those amounts, written as given. Never add, subtract, average or estimate amounts yourself, and never invent a budget, a forecast, a company, a person or a reason a cost happened.
- Refer to a finding by its id in findingId. Do not make up ids.
- For each high-severity finding give at least one option, and at most three options per finding. Choose from: adjust_budget (raise or lower the line with a recorded reason), reallocate (move budget from a line with room), review_commitment (check the subcontract or purchase order, scope and variations), check_costs (check the recorded costs for errors or a wrong code), raise_variation (the extra cost may be recoverable from the client), get_forecast (the cost to complete is needed before deciding), no_action (explain why none is needed).
- Say plainly when you cannot tell which option is right and what the person should look at to decide. Do not recommend reallocating from a line unless its figures in the input show room.
- With no findings, say the checks found nothing to flag, and that this is not a guarantee the budget is right.
- Answer the question asked. Keep the history in mind. If asked for a reason for an adjustment, write draftReason: one or two neutral sentences, with no amounts you were not given.
- Plain Australian English, short sentences, no hype.`;

const num = (v: string) => `$${v}`;

export const budgetReviewPrompt = definePrompt({
  id: 'budget.review',
  version: 1,
  feature: 'budget_review',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: BudgetReviewInput,
  output: BudgetReviewOutput,
  render: (i) => {
    const findings = i.findings
      .map((f) => {
        const figs = Object.entries(f.figures)
          .map(([k, v]) => `${k}="${num(v)}"`)
          .join(' ');
        return `<finding id="${escapeContent(f.id)}" kind="${f.kind}" severity="${f.severity}" code="${escapeContent(f.code)}" description="${escapeContent(f.description)}" ${figs}>${escapeContent(f.summary)}</finding>`;
      })
      .join('\n');
    const turns = i.history
      .map((t) => `<turn role="${t.role}">${escapeContent(t.text)}</turn>`)
      .join('\n');
    return {
      text:
        `<input>\n<budget lines="${i.lineCount}" status="${i.locked ? 'locked' : 'draft'}" revised="${num(i.totals.revised)}" committed="${num(i.totals.committed)}" spent="${num(i.totals.actual)}" />\n` +
        `${findings || '<no_findings />'}\n${turns}\n` +
        `<question>${escapeContent(i.question || 'Give me an opening read of this budget.')}</question>\n</input>`,
    };
  },
  maxOutputTokens: 1800,
});
