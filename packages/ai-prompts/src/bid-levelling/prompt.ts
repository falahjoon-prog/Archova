// Nova on the bid comparison (ai/10): the estimator has the confirmed bids for a tender package and wants them levelled
// onto the package's scope schedule, the scope gaps between them explained and a view on who to award. Bids are
// anonymous ("Bid A"); code works out every price, gap allowance, normalised total and rank before the model sees
// them. Nova explains, suggests where unmatched lines belong, and recommends; she never awards. No company names,
// contacts, notes or estimator allowances in the input.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';
import { NegotiateTurn } from '../quote-negotiate/prompt';

export const MAX_LEVEL_BIDS = 12;
export const MAX_LEVEL_SCOPE = 80;
const Amount = z.string().regex(/^\d{1,12}\.\d{2}$/);
const Label = z.string().regex(/^Bid [A-Z]$/);
const Key = z.string().regex(/^[a-z0-9_]{1,40}$/);

export const BidLevelInput = z.object({
  trade: z.string().max(100),
  scope: z
    .array(z.object({ key: Key, description: z.string().max(300), unit: z.string().max(20) }))
    .max(MAX_LEVEL_SCOPE),
  bids: z
    .array(
      z.object({
        label: Label,
        totalExGst: Amount,
        /** The total plus code's allowance for each scope line the bid leaves out (never the estimator's own). */
        normalisedExGst: Amount,
        rank: z.number().int().min(1),
        validUntil: z.string().max(10).nullable(),
        validityExpired: z.boolean(),
        cells: z.array(
          z.object({
            scopeKey: Key,
            amountExGst: Amount.nullable(),
            provisional: z.boolean(),
            excluded: z.boolean(),
            /** What code adds for the gap: the median of the other bids' prices; null when fewer than two others price it. */
            allowanceExGst: Amount.nullable(),
          }),
        ),
        unmapped: z.array(
          z.object({
            ref: z.string().max(10),
            description: z.string().max(300),
            amountExGst: Amount,
          }),
        ),
        exclusions: z.array(z.string().max(500)).max(30),
        qualifications: z.array(z.string().max(500)).max(30),
      }),
    )
    .min(1)
    .max(MAX_LEVEL_BIDS),
  medianNormalisedExGst: Amount.nullable(),
  history: z.array(NegotiateTurn).max(10),
  question: z.string().max(1000),
});
export type BidLevelInput = z.infer<typeof BidLevelInput>;

export const BidLevelOutput = z.object({
  summary: z.string().min(1).max(1200),
  /** Where a bid's unmatched line probably belongs on the schedule; the estimator confirms. */
  mappings: z
    .array(
      z.object({ bid: Label, ref: z.string().max(10), scopeKey: Key, reason: z.string().max(200) }),
    )
    .max(20),
  /** What a bid's gap or exclusion probably means and what to ask. */
  gaps: z
    .array(z.object({ bid: Label, scopeKey: Key.nullable(), text: z.string().min(1).max(300) }))
    .max(16),
  risks: z.array(z.object({ bid: Label, text: z.string().min(1).max(300) })).max(10),
  recommendation: z.object({
    /** The bid Nova would take forward, or null when the field can't be separated yet. */
    bid: Label.nullable(),
    reasoning: z.string().max(900),
    /** Things to settle with that bid before awarding. */
    conditions: z.array(z.string().min(1).max(200)).max(5),
  }),
});
export type BidLevelOutput = z.infer<typeof BidLevelOutput>;

const SYSTEM = `You are Nova, the Archova assistant, helping a builder's estimator level subcontractor bids for one trade package on an Australian construction project. You are not a licensed agent and not a decision maker.

${UNTRUSTED_CONTENT_RULE}

Rules:
- You suggest. You never award, accept, reject or agree anything, and never say a subcontractor has been chosen. A recommendation is a view for the estimator to weigh.
- Use only the figures in the input. Totals, normalised totals, allowances and ranks are already worked out by code: repeat them, never recalculate them or invent a price.
- A bid's normalised total is its total plus an allowance for every scope line it leaves unpriced. A bid that looks cheapest only because it leaves scope out should not win on price alone; say so.
- For each unmatched line (unmapped), suggest the scope line it most likely belongs to only when the description clearly matches; otherwise leave it out.
- For gaps, exclusions, qualifications, provisional sums and expired validity: say what each could cost or risk and what to ask the subcontractor.
- Recommend a bid only when the field can be separated on the evidence: normalised price, completeness of scope, exclusions, validity. With one bid, or when bids are too close or too incomplete to separate, set recommendation.bid to null and say what is needed.
- Never recommend a bid whose validity has expired without making renewing it a condition.
- Never guess or mention company names or contacts. Refer to bids only by their label.
- Plain Australian English, short sentences, no hype.`;

const dollars = (v: string) => `$${v}`;

export const bidLevelPrompt = definePrompt({
  id: 'bid.level',
  version: 1,
  feature: 'bid_levelling',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: BidLevelInput,
  output: BidLevelOutput,
  render: (i) => {
    const scope = i.scope
      .map(
        (s) =>
          `<scope key="${s.key}" unit="${escapeContent(s.unit)}">${escapeContent(s.description)}</scope>`,
      )
      .join('\n');
    const list = (tag: string, items: string[]) =>
      items.map((t) => `<${tag}>${escapeContent(t)}</${tag}>`).join('\n');
    const bids = i.bids
      .map((b) => {
        const cells = b.cells
          .map(
            (c) =>
              `<cell key="${c.scopeKey}" amount="${c.amountExGst ?? 'not priced'}"${c.provisional ? ' provisional="true"' : ''}${c.excluded ? ' excluded="true"' : ''}${c.allowanceExGst ? ` allowance="${dollars(c.allowanceExGst)}"` : ''} />`,
          )
          .join('\n');
        const unmapped = b.unmapped
          .map(
            (u) =>
              `<unmapped ref="${escapeContent(u.ref)}" amount="${dollars(u.amountExGst)}">${escapeContent(u.description)}</unmapped>`,
          )
          .join('\n');
        return `<bid label="${b.label}" total="${dollars(b.totalExGst)}" normalised="${dollars(b.normalisedExGst)}" rank="${b.rank}" valid_until="${b.validUntil ?? 'not stated'}"${b.validityExpired ? ' validity_expired="true"' : ''}>\n${cells}\n${unmapped}\n${list('exclusion', b.exclusions)}\n${list('qualification', b.qualifications)}\n</bid>`;
      })
      .join('\n');
    return {
      text:
        `<input>\n<trade>${escapeContent(i.trade)}</trade>\n<schedule>\n${scope}\n</schedule>\n${bids}\n` +
        `<field bids="${i.bids.length}"${i.medianNormalisedExGst ? ` median_normalised="${dollars(i.medianNormalisedExGst)}"` : ''} />\n` +
        `${i.history.map((t) => `<turn role="${t.role}">${escapeContent(t.text)}</turn>`).join('\n')}\n` +
        `<question>${escapeContent(i.question || 'Level these bids and tell me who you would take forward.')}</question>\n</input>`,
    };
  },
  maxOutputTokens: 2400,
});
