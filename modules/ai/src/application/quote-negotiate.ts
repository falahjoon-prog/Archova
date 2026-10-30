// Elena on the quote comparison (ai/10): help negotiating one confirmed subcontractor quote. The service hands the model
// the quote's prices and terms and a gap that code worked out against the estimator's target price or the field's median,
// then checks the answer (a counter-offer that makes sense, only figures the quote holds). Elena sees no company,
// contact, note or allowance, only what `estimating.api.quoteForNegotiation` returns. Nothing is saved, sent or agreed.
import {
  MAX_NEGOTIATE_LINES,
  quoteNegotiatePrompt,
  type NegotiateTurn,
  type QuoteNegotiateInput,
} from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  ELENA_DISCLAIMER,
  computeGap,
  reviewNegotiation,
  toCents,
  type Gap,
  type ReviewedNegotiation,
} from '../domain/quote-negotiate';
import type { Gateway } from './gateway';

export const QUOTE_NEGOTIATE_PERMISSION = 'estimating.quotes.review';

export interface QuoteForNegotiation {
  trade: string;
  totalExGst: string;
  validUntil: string | null;
  validityExpired: boolean;
  unmappedLines: number;
  lines: QuoteNegotiateInput['quote']['lines'];
  exclusions: string[];
  qualifications: string[];
  field: QuoteNegotiateInput['field'];
}

export interface QuoteNegotiateDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** `estimating.api.quoteForNegotiation`: throws `tender.not_found` / `quote.not_found` when the caller can't see it. */
  quote: (
    scope: TenantScope,
    projectId: string,
    packageId: string,
    quoteId: string,
  ) => Promise<QuoteForNegotiation>;
}

export interface QuoteNegotiation extends ReviewedNegotiation {
  runId: string;
  gap: Gap;
  stance: Gap['stance'];
  disclaimer: string;
  /** Pass back with the next question so Elena remembers the conversation; the server keeps none. */
  history: NegotiateTurn[];
}

export function createQuoteNegotiateService(deps: QuoteNegotiateDeps) {
  const { database } = deps;

  async function negotiate(
    ctx: TenantContext,
    projectId: string,
    input: {
      packageId: string;
      quoteId: string;
      targetExGst: string | null;
      question: string;
      history: NegotiateTurn[];
    },
    signal?: AbortSignal,
  ): Promise<QuoteNegotiation> {
    if (input.targetExGst !== null && toCents(input.targetExGst) <= 0)
      throw new AppError('validation_failed', 'The target price must be more than zero.', [
        { path: 'targetExGst', message: 'Enter an amount above zero' },
      ]);
    const q = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, QUOTE_NEGOTIATE_PERMISSION, { projectId });
        return deps.quote(scope, projectId, input.packageId, input.quoteId);
      },
      { readOnly: true },
    );
    const gap = computeGap({
      totalExGst: q.totalExGst,
      targetExGst: input.targetExGst,
      field: q.field,
    });
    const lines = q.lines.slice(0, MAX_NEGOTIATE_LINES).map((l) => ({
      ...l,
      description: l.description.slice(0, 300),
    }));
    const question = input.question.trim();
    const run = await deps.gateway.runTask(
      ctx,
      quoteNegotiatePrompt,
      {
        trade: q.trade.slice(0, 100),
        quote: {
          totalExGst: q.totalExGst,
          validUntil: q.validUntil,
          lines,
          exclusions: q.exclusions.map((t) => t.slice(0, 500)).slice(0, 30),
          qualifications: q.qualifications.map((t) => t.slice(0, 500)).slice(0, 30),
          unmappedLines: q.unmappedLines,
        },
        gap,
        field: q.field,
        history: input.history,
        question,
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Elena couldn't help with this quote. Try again.");
    const reviewed = reviewNegotiation(run.output, {
      scopeKeys: new Set(lines.map((l) => l.scopeKey)),
      totalExGst: q.totalExGst,
      gap,
      lowestExGst: q.field.lowestExGst,
      medianExGst: q.field.medianExGst,
      lineAmounts: lines.map((l) => l.amountExGst),
    });
    const history: NegotiateTurn[] = [
      ...input.history,
      ...(question ? [{ role: 'estimator' as const, text: question }] : []),
      { role: 'elena' as const, text: reviewed.reply.slice(0, 1500) },
    ].slice(-10);
    return {
      ...reviewed,
      runId: run.runId,
      gap,
      stance: gap.stance,
      disclaimer: ELENA_DISCLAIMER,
      history,
    };
  }

  return { negotiate };
}

export type QuoteNegotiateService = ReturnType<typeof createQuoteNegotiateService>;
