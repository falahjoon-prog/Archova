import { and, eq, isNotNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { postableRange } from '../domain/posting';
import { allocations, assets, costPostings } from '../infra/tables';

/** What the job needs from `financials`: post a plant cost to a project's budget, or say there is no budget line. */
export type PostPlantCost = (
  scope: TenantScope,
  projectId: string,
  input: {
    costCodeId: string;
    description: string;
    supplier?: string | undefined;
    reference: string;
    incurredOn: string;
    amountCents: number;
  },
) => Promise<{ directCostId: string } | null>;

/**
 * Posts the hire cost of allocated machines to project budgets. Only hired machines with a daily rate, and only
 * allocations tagged with a cost code: owned plant has no invoice to post. Safe to run twice: `posted_through` and
 * the unique posting range stop a day being posted twice. An allocation whose project has no budget line for its
 * cost code is left alone and tried again next run.
 */
export async function postHireCosts(
  scope: TenantScope,
  today: string,
  post: PostPlantCost,
): Promise<{ posted: number; waiting: number }> {
  const rows = await scope.tx
    .select({ a: allocations, asset: assets })
    .from(allocations)
    .innerJoin(assets, eq(assets.id, allocations.assetId))
    .where(
      and(
        eq(allocations.status, 'active'),
        isNotNull(allocations.costCodeId),
        eq(assets.ownership, 'hired'),
        isNotNull(assets.dailyRateCents),
      ),
    )
    .limit(2000);
  let posted = 0;
  let waiting = 0;
  for (const { a, asset } of rows) {
    const range = postableRange(a, today);
    if (!range || !asset.dailyRateCents || asset.dailyRateCents <= 0) continue;
    const amountCents = asset.dailyRateCents * range.days;
    const result = await post(scope, a.projectId, {
      costCodeId: a.costCodeId!,
      description: `Plant hire: ${asset.name} (${asset.assetNumber}), ${range.from} to ${range.to}`,
      supplier: asset.supplier ?? undefined,
      reference: `${asset.assetNumber} ${range.from}`,
      incurredOn: range.to,
      amountCents,
    });
    if (!result) {
      waiting += 1;
      continue;
    }
    await scope.tx.insert(costPostings).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      allocationId: a.id,
      assetId: asset.id,
      projectId: a.projectId,
      fromOn: range.from,
      toOn: range.to,
      days: range.days,
      amountCents,
      directCostId: result.directCostId,
    });
    await scope.tx
      .update(allocations)
      .set({ postedThrough: range.to })
      .where(eq(allocations.id, a.id));
    posted += 1;
  }
  return { posted, waiting };
}
