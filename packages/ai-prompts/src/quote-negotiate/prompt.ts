// Elena on the quote comparison (ai/10): the estimator has a confirmed subcontractor quote and wants help negotiating
// it. The trade, this one quote (total, lines, exclusions, qualifications), the gap to the target price or the field and
// the conversation so far go in; a read of the gap, points to raise, a counter-offer to consider and a message the
// estimator can send come out. Elena suggests and never commits. Code, not the model, works out every gap. The input
// holds no company names, contacts or internal notes.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const MAX_NEGOTIATE_LINES = 100;
export const MAX_NEGOTIATE_TURNS = 10;
const Amount = z.string().regex(/^\d{1,12}\.\d{2}$/);

export const NegotiateStance = z.enum(['above', 'within', 'below', 'no_reference']);
export type NegotiateStance = z.infer<typeof NegotiateStance>;

export const NegotiateLine = z.object({
  scopeKey: z.string().regex(/^[a-z0-9_]{1,40}$/),
  description: z.string().max(300),
  /** The quote's price for the line, ex GST; null when the quote has no line for it. */
  amountExGst: Amount.nullable(),
  provisional: z.boolean(),
});

export const NegotiateTurn = z.object({
  role: z.enum(['estimator', 'elena']),
  text: z.string().min(1).max(1500),
});
export type NegotiateTurn = z.infer<typeof NegotiateTurn>;

export const QuoteNegotiateInput = z.object({
  trade: z.string().max(100),
  quote: z.object({
    totalExGst: Amount,
    validUntil: z.string().max(10).nullable(),
    lines: z.array(NegotiateLine).max(MAX_NEGOTIATE_LINES),
    exclusions: z.array(z.string().max(500)).max(30),
    qualifications: z.array(z.string().max(500)).max(30),
    unmappedLines: z.number().int().min(0),
  }),
  /** Worked out by code; the model never does this arithmetic. */
  gap: z.object({
    against: z.enum(['target', 'median']).nullable(),
    referenceExGst: Amount.nullable(),
    differenceExGst: z.string().max(20).nullable(),
    percent: z.number().nullable(),
    stance: NegotiateStance,
  }),
  field: z.object({
    quotes: z.number().int().min(1),
    lowestExGst: Amount,
    medianExGst: Amount.nullable(),
  }),
  history: z.array(NegotiateTurn).max(MAX_NEGOTIATE_TURNS),
  /** What the estimator just asked; empty for an opening read. */
  question: z.string().max(1000),
});
export type QuoteNegotiateInput = z.infer<typeof QuoteNegotiateInput>;

export const QuoteNegotiateOutput = z.object({
  reply: z.string().min(1).max(1200),
  points: z
    .array(z.object({ scopeKey: z.string().max(40).nullable(), text: z.string().min(1).max(300) }))
    .max(6),
  /** Ways to close a gap without a bare price cut: scope, staging, programme, terms. */
  levers: z.array(z.string().min(1).max(200)).max(4),
  /** A price to consider countering with, ex GST; null when none is warranted. */
  counterExGst: Amount.nullable(),
  counterReason: z.string().max(400),
  /** A message the estimator can edit and send; null unless the question calls for one. */
  draftMessage: z.string().max(1500).nullable(),
});
export type QuoteNegotiateOutput = z.infer<typeof QuoteNegotiateOutput>;

const SYSTEM = `You are Elena, an AI assistant helping a builder's estimator negotiate a subcontractor's quote on an Australian construction project. You are not a licensed agent and not a decision maker.

${UNTRUSTED_CONTENT_RULE}

Rules:
- You suggest. You never accept, reject, award, agree a price or sign anything, and never say the subcontractor has agreed. A counter-offer is a figure for the estimator to consider.
- Use only the figures in the input. The gap, its direction and the stance are already worked out: repeat them, never recalculate them or invent a budget.
- stance "no_reference": there is no target price and fewer than three quotes. Say you can't tell whether the price is high or low, and suggest setting a target price.
- stance "above": look for what could close the gap without cutting quality or safety: scope the builder can take back, phased delivery, programme flexibility, early payment, fixed prices instead of provisional sums. stance "below": first check for unpriced scope, exclusions and qualifications before treating the price as good news. stance "within": firm up scope and terms rather than push the price.
- Point out scope lines the quote does not price, provisional sums, exclusions, qualifications and an expired validity, and how each could change the real price.
- counterExGst must be lower than the quote total and at least half of it, and only when stance is "above"; otherwise null.
- Never guess or mention company names, contact details or other subcontractors' prices beyond the field figures given. Never suggest sharing one subcontractor's prices with another.
- A draftMessage is polite and firm, for the estimator to send, makes no commitments and uses no figures except the quote's own and the counter-offer.
- Plain Australian English, short sentences, no hype.`;

const dollars = (v: string) => `$${v}`;

export const quoteNegotiatePrompt = definePrompt({
  id: 'quote.negotiate',
  version: 1,
  feature: 'quote_negotiation',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: QuoteNegotiateInput,
  output: QuoteNegotiateOutput,
  render: (i) => {
    const q = i.quote;
    const lines = q.lines
      .map(
        (l) =>
          `<line key="${l.scopeKey}" amount="${l.amountExGst ?? 'not priced'}"${l.provisional ? ' provisional="true"' : ''}>${escapeContent(l.description)}</line>`,
      )
      .join('\n');
    const list = (tag: string, items: string[]) =>
      items.map((t) => `<${tag}>${escapeContent(t)}</${tag}>`).join('\n');
    const g = i.gap;
    return {
      text:
        `<input>\n<trade>${escapeContent(i.trade)}</trade>\n` +
        `<quote total="${dollars(q.totalExGst)} ex GST" valid_until="${q.validUntil ?? 'not stated'}" lines_outside_scope="${q.unmappedLines}">\n${lines}\n${list('exclusion', q.exclusions)}\n${list('qualification', q.qualifications)}\n</quote>\n` +
        `<gap stance="${g.stance}"${g.against ? ` against="${g.against}" reference="${dollars(g.referenceExGst ?? '')}" difference="${g.differenceExGst ?? ''}" percent="${g.percent ?? ''}"` : ''} />\n` +
        `<field quotes="${i.field.quotes}" lowest="${dollars(i.field.lowestExGst)}"${i.field.medianExGst ? ` median="${dollars(i.field.medianExGst)}"` : ''} />\n` +
        `${i.history.map((t) => `<turn role="${t.role}">${escapeContent(t.text)}</turn>`).join('\n')}\n` +
        `<question>${escapeContent(i.question || 'Give me an opening read of this quote.')}</question>\n</input>`,
    };
  },
  maxOutputTokens: 1800,
});
