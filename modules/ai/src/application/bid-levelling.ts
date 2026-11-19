// Nova on the bid comparison (ai/10): level every confirmed bid of a tender package onto its scope schedule, explain
// the gaps and say who she would take forward. The service hands the model anonymous bids with code-worked figures and
// checks the answer. Nova sees no company, contact, note or allowance. Nothing is saved, sent or awarded.
import { MAX_LEVEL_BIDS, bidLevelPrompt, type NegotiateTurn } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  LEVEL_DISCLAIMER,
  levelBids,
  reviewLevelling,
  type BidsForLevelling,
  type LevelledBid,
  type ReviewedLevelling,
} from '../domain/bid-levelling';
import type { Gateway } from './gateway';

export const BID_LEVEL_PERMISSION = 'estimating.quotes.review';

export interface BidLevelDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** `estimating.api.bidsForLevelling`: throws `tender.not_found` when the caller can't see the package. */
  bids: (scope: TenantScope, projectId: string, packageId: string) => Promise<BidsForLevelling>;
}

export interface BidLevelling extends ReviewedLevelling {
  runId: string;
  bids: LevelledBid[];
  medianNormalisedExGst: string | null;
  disclaimer: string;
  /** Pass back with the next question so Nova remembers the conversation; the server keeps none. */
  history: NegotiateTurn[];
}

export function createBidLevelService(deps: BidLevelDeps) {
  const { database } = deps;

  async function level(
    ctx: TenantContext,
    projectId: string,
    input: { packageId: string; question: string; history: NegotiateTurn[] },
    signal?: AbortSignal,
  ): Promise<BidLevelling> {
    const facts = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, BID_LEVEL_PERMISSION, { projectId });
        return deps.bids(scope, projectId, input.packageId);
      },
      { readOnly: true },
    );
    if (facts.bids.length === 0)
      throw new AppError('validation_failed', 'There are no confirmed bids to level yet.');
    if (facts.bids.length > MAX_LEVEL_BIDS)
      throw new AppError(
        'validation_failed',
        `Nova can level up to ${MAX_LEVEL_BIDS} bids at once.`,
      );
    const levelled = levelBids({
      ...facts,
      scope: facts.scope.slice(0, 80).map((s) => ({
        ...s,
        description: s.description.slice(0, 300),
      })),
      bids: facts.bids.map((b) => ({
        ...b,
        unmapped: b.unmapped.slice(0, 20).map((u) => ({
          ...u,
          description: u.description.slice(0, 300),
        })),
        exclusions: b.exclusions.slice(0, 30).map((e) => ({ ...e, text: e.text.slice(0, 500) })),
        qualifications: b.qualifications
          .slice(0, 30)
          .map((e) => ({ ...e, text: e.text.slice(0, 500) })),
      })),
    });
    const question = input.question.trim();
    const run = await deps.gateway.runTask(
      ctx,
      bidLevelPrompt,
      {
        ...levelled.input,
        trade: facts.trade.slice(0, 100),
        history: input.history,
        question,
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't level these bids. Try again.");
    const reviewed = reviewLevelling(run.output, facts, levelled);
    const history: NegotiateTurn[] = [
      ...input.history,
      ...(question ? [{ role: 'estimator' as const, text: question }] : []),
      { role: 'nova' as const, text: reviewed.summary.slice(0, 1500) },
    ].slice(-10);
    return {
      ...reviewed,
      runId: run.runId,
      bids: levelled.bids,
      medianNormalisedExGst: levelled.medianNormalisedExGst,
      disclaimer: LEVEL_DISCLAIMER,
      history,
    };
  }

  return { level };
}

export type BidLevelService = ReturnType<typeof createBidLevelService>;
