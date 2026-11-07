// Nova on the labor productivity report (Ai on top): a cost code's crew is producing slower than the plan allows. The
// row's figures, the recent quantity entries and a few numbers worked out by code go in, with the conversation so
// far; likely causes to check on site, questions to ask the supervisor and a short reply come out. Nova suggests and
// talks it through; it never blames a person, changes the plan or books anything. The input holds no worker names.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const MAX_LABOR_TURNS = 10;
export const MAX_LABOR_ENTRIES = 20;

export const LaborTurn = z.object({
  role: z.enum(['user', 'nova']),
  text: z.string().min(1).max(1500),
});
export type LaborTurn = z.infer<typeof LaborTurn>;

const Num = z.number().finite();

export const LaborProductivityInput = z.object({
  costCode: z.string().max(30),
  description: z.string().max(200),
  uom: z.string().max(20),
  /** From the report; hours are decimal hours, rates are units per hour, shares are fractions (1 = 100%). */
  row: z.object({
    budgetedHours: Num,
    timesheetHours: Num,
    pctHoursUsed: Num.nullable(),
    pctComplete: Num.nullable(),
    earnedHours: Num.nullable(),
    budgetedQuantity: Num,
    quantityComplete: Num,
    budgetedRate: Num.nullable(),
    actualRate: Num.nullable(),
  }),
  /** Worked out by code; the model never does this arithmetic. */
  derived: z.object({
    /** How far the actual rate is under the budgeted rate, as a fraction of the budgeted rate. */
    shortfall: Num.nullable(),
    /** Hours the whole quantity would take at the actual rate so far. */
    projectedHours: Num.nullable(),
    /** Projected hours less budgeted hours; positive is an overrun. */
    overrunHours: Num.nullable(),
  }),
  recent: z.array(z.object({ loggedOn: z.string().max(10), quantity: Num })).max(MAX_LABOR_ENTRIES),
  project: z.object({
    flaggedRows: z.number().int().min(0),
    unallocatedHours: Num,
  }),
  history: z.array(LaborTurn).max(MAX_LABOR_TURNS),
  /** What the user just asked; empty for an opening read. */
  question: z.string().max(1000),
});
export type LaborProductivityInput = z.infer<typeof LaborProductivityInput>;

export const LaborProductivityOutput = z.object({
  reply: z.string().min(1).max(1200),
  causes: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        why: z.string().min(1).max(300),
        /** What to look at or ask on site to confirm or rule it out. */
        check: z.string().min(1).max(200),
        likelihood: z.enum(['likely', 'possible']),
      }),
    )
    .max(5),
  /** Questions for the supervisor or the user, to keep the discussion going. */
  questions: z.array(z.string().min(1).max(200)).max(3),
});
export type LaborProductivityOutput = z.infer<typeof LaborProductivityOutput>;

const SYSTEM = `You are Nova, the Archova assistant, helping a builder's project manager work out why a cost code's labor productivity is behind plan on an Australian construction project. You are not a decision maker.

${UNTRUSTED_CONTENT_RULE}

Rules:
- You suggest and discuss. You never change the plan, the quantities or the timesheets, never say anything has been changed, and never judge or name any worker or crew member.
- Use only the figures in the input. The shortfall, projected hours and overrun are already worked out: repeat them, never recalculate them or invent other figures.
- Offer likely causes a builder would check, each with something concrete to check on site. Ground them in the figures: a high share of hours used against a low share complete suggests rework, waiting or access problems; a flat recent quantity suggests a stoppage; logged quantity that lags the hours suggests the quantity entries are late rather than the work being slow; hours with no cost code suggest booked time is landing elsewhere. Say when the figures can't tell causes apart.
- Mark a cause "likely" only when the figures point to it; otherwise "possible".
- Ask up to three short questions that would narrow it down (weather, access, material delivery, design changes, rework, a new crew, how the quantity is measured).
- When the user asks a follow-up, answer it directly from the figures and the conversation, and say what you can't know.
- Plain Australian English, short sentences, no hype.`;

const n = (v: number | null) => (v === null ? 'none' : String(v));

export const laborProductivityPrompt = definePrompt({
  id: 'labor.productivity',
  version: 1,
  feature: 'labor_productivity',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: LaborProductivityInput,
  output: LaborProductivityOutput,
  render: (i) => {
    const r = i.row;
    const d = i.derived;
    return {
      text:
        `<input>\n<cost_code code="${escapeContent(i.costCode)}" uom="${escapeContent(i.uom)}">${escapeContent(i.description)}</cost_code>\n` +
        `<row budgeted_hours="${r.budgetedHours}" timesheet_hours="${r.timesheetHours}" pct_hours_used="${n(r.pctHoursUsed)}" pct_complete="${n(r.pctComplete)}" earned_hours="${n(r.earnedHours)}" budgeted_quantity="${r.budgetedQuantity}" quantity_complete="${r.quantityComplete}" budgeted_rate="${n(r.budgetedRate)}" actual_rate="${n(r.actualRate)}" />\n` +
        `<derived shortfall="${n(d.shortfall)}" projected_hours="${n(d.projectedHours)}" overrun_hours="${n(d.overrunHours)}" />\n` +
        `${i.recent.map((e) => `<entry date="${e.loggedOn}" quantity="${e.quantity}" />`).join('\n')}\n` +
        `<project flagged_codes="${i.project.flaggedRows}" unallocated_hours="${i.project.unallocatedHours}" />\n` +
        `${i.history.map((t) => `<turn role="${t.role}">${escapeContent(t.text)}</turn>`).join('\n')}\n` +
        `<question>${escapeContent(i.question || 'Why might this cost code be behind plan?')}</question>\n</input>`,
    };
  },
  maxOutputTokens: 1500,
});
