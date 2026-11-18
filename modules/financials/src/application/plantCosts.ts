import { eq, and } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { budgetLines } from '../infra/tables';
import { fromCents } from '../domain/money';
import { insertDirectCost } from './directCosts';

export interface PlantCostInput {
  costCodeId: string;
  description: string;
  supplier?: string | undefined;
  reference: string;
  /** yyyy-mm-dd, not in the future. */
  incurredOn: string;
  /** Ex GST, in cents, more than zero. */
  amountCents: number;
  /** The person who authorised the hire; recorded as the author of the direct cost. */
  authorisedBy: string;
}

/** Does the cost code belong to the project and have a budget line there? Used when plant is allocated. */
export async function costCodeBudgeted(
  scope: TenantScope,
  projectId: string,
  costCodeId: string,
): Promise<boolean> {
  const [line] = await scope.tx
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .where(and(eq(budgetLines.projectId, projectId), eq(budgetLines.costCodeId, costCodeId)))
    .limit(1);
  return !!line;
}

/**
 * Plant hire posted to a project's budget (`plant` module, scheduled job): a direct cost in the `plant` category on
 * the budget line for the cost code. Returns null when the project has no budget line for that code yet, so the
 * caller leaves the days unposted and tries again once a budget exists. No permission check: the caller is a job.
 */
export async function postPlantCost(
  scope: TenantScope,
  projectId: string,
  input: PlantCostInput,
): Promise<{ directCostId: string } | null> {
  const [line] = await scope.tx
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .where(and(eq(budgetLines.projectId, projectId), eq(budgetLines.costCodeId, input.costCodeId)))
    .limit(1);
  if (!line) return null;
  const cost = await insertDirectCost(scope, projectId, {
    budgetLineId: line.id,
    category: 'plant',
    description: input.description,
    ...(input.supplier ? { supplier: input.supplier } : {}),
    reference: input.reference,
    incurredOn: input.incurredOn,
    amount: fromCents(input.amountCents),
    createdBy: input.authorisedBy,
  });
  return { directCostId: cost.id };
}
