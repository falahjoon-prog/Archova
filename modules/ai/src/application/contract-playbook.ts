// F34 contract playbook (design/09 CR4): the builder's preferred positions per contract type, and the fallback
// wording their lawyer approved. Org admins keep it; the review reads it. One contract type is replaced as a whole,
// so the screen sends the list it shows and there are no per-row ids to keep in step.
import { and, asc, eq } from 'drizzle-orm';
import { PlaybookTopicInput, SEVERITIES, z, type ContractType } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { PlaybookTopic } from '../domain/contract-review';
import { contractPlaybookTopics } from '../infra/tables';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_TOPICS = 40;

/** A topic as an org admin saves it. */
export const PlaybookTopicBody = PlaybookTopicInput.extend({
  severity: z.enum(SEVERITIES),
  fallback: z
    .object({
      title: z.string().trim().min(1).max(160),
      wording: z.string().trim().min(1).max(4000),
      approvedBy: z.string().trim().min(1).max(160),
      approvedOn: z.string().regex(DATE),
      reviewBy: z.string().regex(DATE).nullable(),
    })
    .nullable(),
});
export type PlaybookTopicBody = z.infer<typeof PlaybookTopicBody>;

export const toTopic = (r: typeof contractPlaybookTopics.$inferSelect): PlaybookTopic => ({
  key: r.key,
  topic: r.topic,
  position: r.position,
  threshold: r.threshold,
  severity: r.severity as PlaybookTopic['severity'],
  fallback:
    r.fallbackWording !== null &&
    r.fallbackTitle !== null &&
    r.fallbackApprovedBy !== null &&
    r.fallbackApprovedOn !== null
      ? {
          title: r.fallbackTitle,
          wording: r.fallbackWording,
          approvedBy: r.fallbackApprovedBy,
          approvedOn: r.fallbackApprovedOn,
          reviewBy: r.fallbackReviewBy,
        }
      : null,
});

export function createContractPlaybookService() {
  /** The org's topics for one contract type, in the order the admin set. */
  async function list(scope: TenantScope, contractType: ContractType): Promise<PlaybookTopic[]> {
    const rows = await scope.tx
      .select()
      .from(contractPlaybookTopics)
      .where(
        and(
          eq(contractPlaybookTopics.orgId, scope.ctx.orgId),
          eq(contractPlaybookTopics.contractType, contractType),
        ),
      )
      .orderBy(asc(contractPlaybookTopics.sortOrder), asc(contractPlaybookTopics.key));
    return rows.map(toTopic);
  }

  async function replace(
    scope: TenantScope,
    contractType: ContractType,
    topics: readonly PlaybookTopicBody[],
  ): Promise<PlaybookTopic[]> {
    if (topics.length > MAX_TOPICS)
      throw new AppError('validation_failed', `A playbook holds at most ${MAX_TOPICS} topics.`);
    const seen = new Set<string>();
    topics.forEach((t, i) => {
      if (seen.has(t.key))
        throw new AppError('validation_failed', 'Each topic needs its own key.', [
          { path: `topics[${i}].key`, message: 'Duplicate key' },
        ]);
      seen.add(t.key);
      if (t.fallback?.reviewBy && t.fallback.reviewBy < t.fallback.approvedOn)
        throw new AppError('validation_failed', 'The review date is before the approval date.', [
          { path: `topics[${i}].fallback.reviewBy`, message: 'Before approvedOn' },
        ]);
    });
    await scope.tx
      .delete(contractPlaybookTopics)
      .where(
        and(
          eq(contractPlaybookTopics.orgId, scope.ctx.orgId),
          eq(contractPlaybookTopics.contractType, contractType),
        ),
      );
    if (topics.length)
      await scope.tx.insert(contractPlaybookTopics).values(
        topics.map((t, i) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          contractType,
          key: t.key,
          topic: t.topic,
          position: t.position,
          threshold: t.threshold,
          severity: t.severity,
          sortOrder: i,
          fallbackTitle: t.fallback?.title ?? null,
          fallbackWording: t.fallback?.wording ?? null,
          fallbackApprovedBy: t.fallback?.approvedBy ?? null,
          fallbackApprovedOn: t.fallback?.approvedOn ?? null,
          fallbackReviewBy: t.fallback?.reviewBy ?? null,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })),
      );
    return list(scope, contractType);
  }

  return { list, replace };
}

export type ContractPlaybookService = ReturnType<typeof createContractPlaybookService>;
