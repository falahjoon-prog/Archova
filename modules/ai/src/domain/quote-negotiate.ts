// Elena's negotiation help on a quote (ai/10): code works out the gap before the model sees it and checks what comes
// back. A counter-offer is kept only when it is a price the estimator could sensibly try, and every dollar figure in her
// words must be one the input holds, so she cannot invent a budget or a competitor's price. Pure, no IO.
import type { NegotiateStance, QuoteNegotiateOutput } from '@archova/ai-prompts';

/** Within this many percent of the reference a quote is "within" it. */
export const WITHIN_PERCENT = 5;
/** Quotes needed before the median of the field can stand in for a target price. */
export const MIN_FIELD_FOR_MEDIAN = 3;
/** A counter-offer may not go below this share of the quote total. */
export const MIN_COUNTER_SHARE = 0.5;

export const ELENA_DISCLAIMER =
  'Elena is an AI assistant, not a licensed agent. She suggests; you decide, and nothing is agreed or awarded from here.';

export const toCents = (v: string): number => {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) throw new RangeError(`Not an amount: ${v}`);
  return (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0')));
};
export const fromCents = (c: number): string => {
  const abs = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

export interface Gap {
  against: 'target' | 'median' | null;
  referenceExGst: string | null;
  differenceExGst: string | null;
  percent: number | null;
  stance: NegotiateStance;
}

/**
 * The quote total against the estimator's target price, else the median of the levelled totals (three or more
 * quotes), else nothing: with one or two quotes and no target there is no honest "high" or "low".
 */
export function computeGap(input: {
  totalExGst: string;
  targetExGst: string | null;
  field: { quotes: number; medianExGst: string | null };
}): Gap {
  const reference: ['target' | 'median', string] | null = input.targetExGst
    ? ['target', fromCents(toCents(input.targetExGst))]
    : input.field.quotes >= MIN_FIELD_FOR_MEDIAN && input.field.medianExGst
      ? ['median', input.field.medianExGst]
      : null;
  if (!reference || toCents(reference[1]) <= 0)
    return {
      against: null,
      referenceExGst: null,
      differenceExGst: null,
      percent: null,
      stance: 'no_reference',
    };
  const ref = toCents(reference[1]);
  const diff = toCents(input.totalExGst) - ref;
  const percent = Math.round((diff / ref) * 1000) / 10;
  const stance: NegotiateStance =
    Math.abs(percent) <= WITHIN_PERCENT ? 'within' : diff > 0 ? 'above' : 'below';
  return {
    against: reference[0],
    referenceExGst: reference[1],
    differenceExGst: fromCents(diff),
    percent,
    stance,
  };
}

/** Code's own one-line read of the gap, used when nothing the model wrote could be kept. */
export function gapSentence(g: Gap): string {
  if (g.stance === 'no_reference')
    return "There is no target price and fewer than three quotes, so I can't say whether this price is high or low yet.";
  const diff = fromCents(Math.abs(toCents(g.differenceExGst!)));
  const how =
    g.stance === 'within' ? 'within a few percent of' : g.stance === 'above' ? 'above' : 'below';
  return `This quote is ${how} the ${g.against === 'target' ? 'target price' : 'median of the quotes'} ($${g.referenceExGst}), a difference of $${diff} (${Math.abs(g.percent!)}%).`;
}

const MONEY = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;

/** The dollar figures in some text, in cents. */
export function figuresIn(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => Math.round(Number(m[1]!.replace(/,/g, '')) * 100));
}

export interface NegotiateFacts {
  scopeKeys: ReadonlySet<string>;
  totalExGst: string;
  gap: Gap;
  lowestExGst: string;
  medianExGst: string | null;
  lineAmounts: ReadonlyArray<string | null>;
}

export interface ReviewedNegotiation extends Omit<QuoteNegotiateOutput, 'counterExGst'> {
  counterExGst: string | null;
  /** What code removed, so a trimmed answer is not mistaken for a complete one. */
  notes: string[];
}

export function reviewNegotiation(
  out: QuoteNegotiateOutput,
  f: NegotiateFacts,
): ReviewedNegotiation {
  const notes: string[] = [];
  const total = toCents(f.totalExGst);
  let counter: string | null = null;
  if (out.counterExGst) {
    const c = toCents(out.counterExGst);
    if (f.gap.stance === 'above' && c < total && c >= total * MIN_COUNTER_SHARE)
      counter = out.counterExGst;
    else notes.push("The counter-offer didn't fit this quote, so it was left out.");
  }
  const allowed = new Set<number>(
    [
      f.totalExGst,
      f.gap.referenceExGst,
      f.gap.differenceExGst,
      f.lowestExGst,
      f.medianExGst,
      counter,
      ...f.lineAmounts,
    ]
      .filter((v): v is string => !!v)
      .flatMap((v) => [toCents(v), Math.abs(toCents(v))]),
  );
  const supported = (t: string) => figuresIn(t).every((c) => allowed.has(c));

  const sentences = out.reply.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter(supported);
  if (kept.length < sentences.length)
    notes.push('Sentences with figures that are not in the quote were removed.');
  const points = out.points
    .map((p) => ({
      scopeKey: p.scopeKey && f.scopeKeys.has(p.scopeKey) ? p.scopeKey : null,
      text: p.text,
    }))
    .filter((p) => supported(p.text));
  if (points.length < out.points.length)
    notes.push('A point with an unsupported figure was removed.');
  let draft = out.draftMessage;
  if (draft && !supported(draft)) {
    draft = null;
    notes.push('The draft message used a figure that is not in the quote, so it was left out.');
  }
  return {
    ...out,
    reply: kept.join(' ') || gapSentence(f.gap),
    points,
    levers: out.levers.filter(supported),
    counterExGst: counter,
    counterReason: counter && supported(out.counterReason) ? out.counterReason : '',
    draftMessage: draft,
    notes,
  };
}
