// Nova's read of a project budget (ai/10): code found the problems and worked out every amount before the model saw
// them, and checks what comes back. A point or option must refer to a finding that exists, and every dollar figure in
// Nova's words must be one the findings hold, so she cannot invent a forecast or a budget. Pure, no IO.
import type { BudgetReviewOutput, ReviewFinding } from '@archova/ai-prompts';

export const BUDGET_REVIEW_DISCLAIMER =
  'Nova is an AI assistant, not an accountant. Nova suggests; you decide, and nothing in the budget changes from here.';

const NUM = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
// "$130,000", "AUD 130000", "130000 dollars": any way of writing an amount of money that a reader would take as one.
const MONEY = new RegExp(
  String.raw`(?:\$|\bAUD|\bA\$)\s?${NUM}|${NUM}\s?(?:dollars?|AUD|bucks)\b`,
  'gi',
);

/** The money figures in some text, in cents. */
export function figuresIn(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) =>
    Math.round(Number((m[1] ?? m[2])!.replace(/,/g, '')) * 100),
  );
}

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
/** Text with links and email addresses taken out; the draft reason gets pasted into adjustments, so none may ride along. */
export const withoutLinks = (t: string) =>
  t
    .replace(LINK, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

const cents = (v: string) => {
  const neg = v.startsWith('-');
  const [w = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  return (neg ? -1 : 1) * (Number(w) * 100 + Number(f.padEnd(2, '0')));
};

export interface ReviewFacts {
  findings: readonly ReviewFinding[];
  totals: { revised: string; committed: string; actual: string };
}

export interface ReviewedBudgetAdvice extends Omit<BudgetReviewOutput, 'draftReason'> {
  draftReason: string | null;
  /** What code removed, so a trimmed answer is not mistaken for a complete one. */
  notes: string[];
}

/** Code's own opening line, used when nothing the model wrote could be kept. */
export function summarySentence(f: ReviewFacts): string {
  const high = f.findings.filter((x) => x.severity === 'high').length;
  if (f.findings.length === 0)
    return 'The checks found nothing to flag. That is not a guarantee the budget is right.';
  return `The checks found ${f.findings.length} thing${f.findings.length === 1 ? '' : 's'} to look at, ${high} of them high priority.`;
}

export function reviewBudgetAdvice(out: BudgetReviewOutput, f: ReviewFacts): ReviewedBudgetAdvice {
  const notes: string[] = [];
  const ids = new Set(f.findings.map((x) => x.id));
  const allowed = new Set<number>(
    [...Object.values(f.totals), ...f.findings.flatMap((x) => Object.values(x.figures))].flatMap(
      (v) => [cents(v), Math.abs(cents(v))],
    ),
  );
  const supported = (t: string) => figuresIn(t).every((c) => allowed.has(c));
  const known = (id: string | null) => id === null || ids.has(id);

  let linksRemoved = false;
  const clean = (t: string) => {
    const c = withoutLinks(t);
    if (c !== t.trim()) linksRemoved = true;
    return c;
  };
  out = {
    reply: clean(out.reply),
    points: out.points.map((p) => ({ ...p, text: clean(p.text) })).filter((p) => p.text),
    options: out.options.map((o) => ({ ...o, text: clean(o.text) })).filter((o) => o.text),
    draftReason: out.draftReason ? clean(out.draftReason) || null : null,
  };

  const sentences = out.reply.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter(supported);
  if (kept.length < sentences.length)
    notes.push('Sentences with figures that are not in the budget checks were removed.');

  const points = out.points.filter((p) => known(p.findingId) && supported(p.text));
  if (points.length < out.points.length)
    notes.push('A point about an unknown finding, or with an unsupported figure, was removed.');

  // At most three options per finding, in the order Nova gave them.
  const perFinding = new Map<string, number>();
  const options = out.options.filter((o) => {
    if (!known(o.findingId) || !supported(o.text)) return false;
    const key = o.findingId ?? '';
    const n = (perFinding.get(key) ?? 0) + 1;
    perFinding.set(key, n);
    return n <= 3;
  });
  if (options.length < out.options.length)
    notes.push(
      'An option about an unknown finding, with an unsupported figure, or past three for one line was removed.',
    );

  let draftReason = out.draftReason;
  if (draftReason && !supported(draftReason)) {
    draftReason = null;
    notes.push(
      'The draft reason used a figure that is not in the budget checks, so it was left out.',
    );
  }
  if (linksRemoved) notes.push('Links and email addresses were removed.');
  return {
    reply: kept.join(' ') || summarySentence(f),
    points,
    options,
    draftReason,
    notes,
  };
}
