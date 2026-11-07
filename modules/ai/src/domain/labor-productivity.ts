// Nova's read of a slow cost code: code works out the shortfall and projection before the model sees them, and checks
// what comes back. Every figure in Nova's words must be one the input holds, so it cannot invent hours or rates.
// Pure, no IO.
import type { LaborProductivityInput, LaborProductivityOutput } from '@archova/ai-prompts';

export const LABOR_DISCLAIMER =
  'Nova is an AI assistant. These are things to check, not findings; nothing has been changed on the plan, quantities or timesheets.';

const r2 = (v: number) => Math.round(v * 100) / 100;

export function deriveFigures(row: {
  budgetedHours: number;
  budgetedQuantity: number;
  actualRate: number | null;
  budgetedRate: number | null;
}): LaborProductivityInput['derived'] {
  const { actualRate, budgetedRate } = row;
  const shortfall =
    actualRate !== null && budgetedRate !== null && budgetedRate > 0 && actualRate < budgetedRate
      ? Math.round(((budgetedRate - actualRate) / budgetedRate) * 1000) / 1000
      : null;
  const projectedHours =
    actualRate !== null && actualRate > 0 ? r2(row.budgetedQuantity / actualRate) : null;
  return {
    shortfall,
    projectedHours,
    overrunHours: projectedHours !== null ? r2(projectedHours - row.budgetedHours) : null,
  };
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** The numbers a reply may state: the figures in the input, as they are and as percentages. */
export function allowedFigures(i: LaborProductivityInput): number[] {
  const out: number[] = [];
  const add = (v: number | null) => {
    if (v !== null) out.push(v, Math.abs(v));
  };
  // Shares are stored as fractions but spoken as percentages.
  const addShare = (v: number | null) => {
    if (v === null) return;
    add(v);
    out.push(Math.round(v * 1000) / 10, Math.round(v * 100));
  };
  const shares = new Set(['pctHoursUsed', 'pctComplete']);
  for (const [k, v] of Object.entries(i.row)) (shares.has(k) ? addShare : add)(v);
  addShare(i.derived.shortfall);
  add(i.derived.projectedHours);
  add(i.derived.overrunHours);
  for (const e of i.recent) add(e.quantity);
  add(i.project.flaggedRows);
  add(i.project.unallocatedHours);
  return out;
}

function supported(text: string, allowed: readonly number[]): boolean {
  return [...text.matchAll(NUMBER)].every((m) => {
    const v = Number(m[0].replace(/,/g, ''));
    // Small counts ("three things") and years are not figures about the work.
    if (Number.isInteger(v) && (v <= 10 || (v >= 1900 && v <= 2100))) return true;
    return allowed.some((a) => Math.abs(a - v) < 0.011);
  });
}

export interface ReviewedLabor extends LaborProductivityOutput {
  notes: string[];
}

export function reviewLabor(
  out: LaborProductivityOutput,
  input: LaborProductivityInput,
): ReviewedLabor {
  const allowed = allowedFigures(input);
  const notes: string[] = [];
  const sentences = out.reply.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter((s) => supported(s, allowed));
  if (kept.length < sentences.length)
    notes.push('Sentences with figures that are not in the report were removed.');
  const causes = out.causes.filter((c) => supported(`${c.title} ${c.why} ${c.check}`, allowed));
  if (causes.length < out.causes.length)
    notes.push('A suggested cause with an unsupported figure was removed.');
  return {
    reply: kept.join(' ') || fallbackReply(input),
    causes,
    questions: out.questions.filter((q) => supported(q, allowed)),
    notes,
  };
}

export function fallbackReply(i: LaborProductivityInput): string {
  const { shortfall } = i.derived;
  return shortfall === null
    ? "The figures don't show this code running behind its plan yet."
    : `The crew is producing ${r2(shortfall * 100)}% below the planned rate on ${i.costCode}.`;
}
