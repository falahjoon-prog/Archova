// Nova on the quote comparison (EST-AC6), as the preview shows it: `POST …/ai/quote-negotiations` answers with the gap
// to the target price or the field's median, points to raise, levers, a counter-offer to consider and a draft message.
// The preview works the gap out the same way the server does and answers from fixed wording; the real answer comes from
// Nova. Nova is shown prices and terms only, never the company, contacts, notes or the estimator's allowances.
import type { LevelRow, QuoteTotals } from './levelling';
import type { Quote } from './quote-types';

export type NegotiateStance = 'above' | 'within' | 'below' | 'no_reference';
export type NegotiateTopic = 'overview' | 'counter' | 'scope' | 'message';

/** Within this many percent of the reference a quote is "within" it (same rule as the server). */
export const WITHIN_PERCENT = 5;
/** Quotes needed before the field's median can stand in for a target price. */
export const MIN_FIELD_FOR_MEDIAN = 3;
export const NEGOTIATE_DISCLAIMER =
  'Nova is an AI assistant, not a licensed agent. Nova suggests; you decide, and nothing is agreed or awarded from here.';

export interface NegotiateGap {
  against: 'target' | 'median' | null;
  referenceCents: number | null;
  differenceCents: number | null;
  percent: number | null;
  stance: NegotiateStance;
}

export interface NegotiationTurn {
  role: 'estimator' | 'nova';
  text: string;
}

export interface NegotiateAnswer {
  stance: NegotiateStance;
  gap: NegotiateGap;
  reply: string;
  points: Array<{ scopeKey: string | null; text: string }>;
  levers: string[];
  counterCents: number | null;
  counterReason: string;
  draftMessage: string | null;
}

export function medianOf(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function negotiateGap(
  totalCents: number,
  targetCents: number | null,
  fieldTotals: readonly number[],
): NegotiateGap {
  const reference: ['target' | 'median', number] | null =
    targetCents !== null
      ? ['target', targetCents]
      : fieldTotals.length >= MIN_FIELD_FOR_MEDIAN
        ? ['median', medianOf(fieldTotals)]
        : null;
  if (!reference || reference[1] <= 0)
    return {
      against: null,
      referenceCents: null,
      differenceCents: null,
      percent: null,
      stance: 'no_reference',
    };
  const difference = totalCents - reference[1];
  const percent = Math.round((difference / reference[1]) * 1000) / 10;
  const stance: NegotiateStance =
    Math.abs(percent) <= WITHIN_PERCENT ? 'within' : difference > 0 ? 'above' : 'below';
  return {
    against: reference[0],
    referenceCents: reference[1],
    differenceCents: difference,
    percent,
    stance,
  };
}

const dollars = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

export function previewNegotiate(input: {
  quote: Quote;
  rows: readonly LevelRow[];
  totals: readonly QuoteTotals[];
  trade: string;
  targetCents: number | null;
  topic: NegotiateTopic;
}): NegotiateAnswer {
  const { quote, rows, totals, topic } = input;
  const mine = totals.find((t) => t.quoteId === quote.id)!;
  const gap = negotiateGap(
    mine.quotedCents,
    input.targetCents,
    totals.map((t) => t.normalisedCents),
  );
  const index = totals.findIndex((t) => t.quoteId === quote.id);

  const points: NegotiateAnswer['points'] = [];
  for (const r of rows) {
    const cell = r.cells[index]!;
    if (cell.flags.includes('excluded'))
      points.push({
        scopeKey: r.scope.key,
        text: `"${r.scope.description}" is excluded. Ask what it costs, or who is expected to do it.`,
      });
    else if (cell.amountCents === null)
      points.push({
        scopeKey: r.scope.key,
        text: `The quote has no price for "${r.scope.description}". Ask whether it is included.`,
      });
    else if (cell.flags.includes('provisional'))
      points.push({
        scopeKey: r.scope.key,
        text: `"${r.scope.description}" is a provisional sum (${dollars(cell.amountCents)}). Ask for a fixed price.`,
      });
  }
  for (const n of quote.exclusions.filter((e) => !e.scopeKey))
    points.push({ scopeKey: null, text: `Exclusion: "${n.text}". Price it before comparing.` });
  for (const n of quote.qualifications)
    points.push({
      scopeKey: null,
      text: `Qualification: "${n.text}". Check it doesn't change the price or programme.`,
    });
  if (mine.expired)
    points.push({
      scopeKey: null,
      text: `The quote's validity (${quote.validUntil}) has passed. Ask for it to be re-confirmed in writing.`,
    });

  const levers =
    gap.stance === 'above'
      ? [
          'Ask what a reduced scope would save.',
          'Offer phased delivery or a flexible start.',
          'Ask whether firm prices or earlier payment lower the total.',
        ]
      : gap.stance === 'below'
        ? [
            'Before treating the price as good news, check every scope line is priced and nothing is left out.',
          ]
        : gap.stance === 'within'
          ? [
              'The price is close. Spend the effort on firming up scope, exclusions and payment terms.',
            ]
          : [
              'Set a target price, or wait for more quotes, so there is something to measure this one against.',
            ];

  let counterCents: number | null = null;
  if (gap.stance === 'above' && gap.referenceCents !== null) {
    const open =
      gap.against === 'target'
        ? gap.referenceCents
        : Math.round((gap.referenceCents + mine.quotedCents) / 2);
    counterCents = Math.min(
      mine.quotedCents - 1000,
      Math.max(Math.round(open / 1000) * 1000, Math.ceil(mine.quotedCents / 2)),
    );
    if (counterCents <= 0 || counterCents >= mine.quotedCents) counterCents = null;
  }

  const name = gap.against === 'target' ? 'your target price' : 'the median of the quotes';
  const reply =
    gap.stance === 'no_reference'
      ? `I can't say yet whether ${dollars(mine.quotedCents)} is high or low. A target price, or three or more quotes, would let me.`
      : `This quote is ${dollars(Math.abs(gap.differenceCents!))} (${Math.abs(gap.percent!)}%) ${gap.stance === 'within' ? 'from' : gap.stance} ${name} (${dollars(gap.referenceCents!)}).`;
  const message =
    topic === 'message'
      ? [
          counterCents
            ? `Thanks for your ${input.trade} quote of ${dollars(mine.quotedCents)} (ex GST). We'd like to move forward and need to be closer to ${dollars(counterCents)} (ex GST). Could you look at scope, staging or programme options that get you there?`
            : `Thanks for your ${input.trade} quote of ${dollars(mine.quotedCents)} (ex GST). Before we go further, we'd like to confirm a few points.`,
          '',
          'This is not an acceptance or an offer of work. Please reply in writing.',
        ].join('\n')
      : null;
  return {
    stance: gap.stance,
    gap,
    reply,
    points: topic === 'counter' || topic === 'message' ? [] : points,
    levers: topic === 'scope' || topic === 'message' ? [] : levers,
    counterCents: topic === 'scope' ? null : counterCents,
    counterReason: counterCents
      ? gap.against === 'target'
        ? 'Your target price. You may want to open slightly under it.'
        : 'Halfway between the median of the quotes and this quote.'
      : '',
    draftMessage: message,
  };
}
