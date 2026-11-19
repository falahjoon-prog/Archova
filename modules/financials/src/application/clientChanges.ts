import { and, asc, eq } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { contracts, variations } from '../infra/tables';

export interface ClientChange {
  number: number;
  title: string;
  description: string | null;
  timeImpactDays: number;
  approvedAt: Date | null;
}

/**
 * The approved variations to the head contract, for the client share link (`ownerportal`). Deliberately narrow:
 * no amounts, no decision notes, nothing from subcontracts. The caller has already authorised the link, so this
 * does no permission check and must never be wired to a route.
 */
export async function approvedClientChanges(
  scope: TenantScope,
  projectId: string,
): Promise<ClientChange[]> {
  const rows = await scope.tx
    .select({
      number: variations.number,
      title: variations.title,
      description: variations.description,
      timeImpactDays: variations.timeImpactDays,
      approvedAt: variations.decidedAt,
    })
    .from(variations)
    .innerJoin(contracts, eq(contracts.id, variations.contractId))
    .where(
      and(
        eq(variations.projectId, projectId),
        eq(variations.status, 'approved'),
        eq(contracts.kind, 'head'),
      ),
    )
    .orderBy(asc(variations.decidedAt), asc(variations.number))
    .limit(100);
  return rows;
}
