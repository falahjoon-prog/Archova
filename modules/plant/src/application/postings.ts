import { and, eq, isNotNull } from 'drizzle-orm';
import { recordRetention } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
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
    authorisedBy: string;
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
  access: AccessService,
): Promise<{ posted: number; waiting: number; skipped: number }> {
  // skip locked: a run that overlaps another leaves the rows the other holds, so nothing is posted twice.
  const rows = await scope.tx
    .select({ a: allocations, asset: assets })
    .from(allocations)
    .innerJoin(assets, eq(assets.id, allocations.assetId))
    .where(
      and(
        eq(allocations.status, 'active'),
        isNotNull(allocations.costCodeId),
        isNotNull(allocations.createdBy),
        eq(assets.ownership, 'hired'),
        isNotNull(assets.dailyRateCents),
      ),
    )
    .limit(2000)
    .for('update', { of: allocations, skipLocked: true });
  let posted = 0;
  let waiting = 0;
  let skipped = 0;
  for (const { a, asset } of rows) {
    const range = postableRange(a, today);
    if (!range || !asset.dailyRateCents || asset.dailyRateCents <= 0) continue;
    try {
      // One savepoint per allocation: a bad row rolls back alone and doesn't block the org's other postings.
      const outcome = await scope.tx.transaction(async (tx) => {
        const inner = { ...scope, tx } as TenantScope;
        // The person who allocated it must still be allowed to charge that project's budget.
        const author = a.createdBy!;
        if (!(await access.canUser(inner, author, 'financials.direct_costs.manage', a.projectId)))
          return 'skipped' as const;
        const amountCents = asset.dailyRateCents! * range.days;
        const result = await post(inner, a.projectId, {
          costCodeId: a.costCodeId!,
          description: `Plant hire: ${asset.name} (${asset.assetNumber}), ${range.from} to ${range.to}`,
          supplier: asset.supplier ?? undefined,
          reference: `${asset.assetNumber} ${range.from} alloc:${a.id}`,
          incurredOn: range.to,
          amountCents,
          authorisedBy: author,
        });
        if (!result) return 'waiting' as const;
        const id = uuidv7();
        await tx.insert(costPostings).values({
          id,
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
        await recordRetention(inner, {
          recordType: 'plant.cost_postings',
          recordId: id,
          projectId: a.projectId,
          category: 'financial_7y',
          anchor: new Date(),
        });
        await tx
          .update(allocations)
          .set({ postedThrough: range.to })
          .where(eq(allocations.id, a.id));
        return 'posted' as const;
      });
      if (outcome === 'posted') posted += 1;
      else if (outcome === 'waiting') waiting += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { posted, waiting, skipped };
}
