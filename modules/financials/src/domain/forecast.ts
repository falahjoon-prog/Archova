// Cost forecast (product/09). All maths in whole cents, ex GST. A commitment's cost to complete is what is still
// unclaimed against its approved value; an over-claim never produces a negative remainder. Submitted variations are
// shown as exposure but are not in the forecast until approved.

export interface CommitmentInput {
  contractId: string;
  originalCents: number;
  approvedVariationCents: number;
  pendingVariationCents: number;
  claimedCents: number;
}

export interface AdjustmentInput {
  contractId: string | null;
  amountCents: number;
}

export interface CommitmentForecast {
  contractId: string;
  committedCents: number;
  claimedCents: number;
  costToCompleteCents: number;
  adjustmentsCents: number;
  forecastFinalCents: number;
  pendingVariationCents: number;
}

export interface ProjectForecast {
  commitments: CommitmentForecast[];
  committedCents: number;
  claimedCents: number;
  costToCompleteCents: number;
  projectAdjustmentsCents: number;
  forecastFinalCostCents: number;
  pendingCostExposureCents: number;
  revenueCents: number;
  billedCents: number;
  pendingRevenueCents: number;
  forecastMarginCents: number;
  /** Hundredths of a percent of revenue, null when there is no revenue. */
  forecastMarginPctHundredths: number | null;
}

export interface HeadInput {
  originalCents: number;
  approvedVariationCents: number;
  pendingVariationCents: number;
  claimedCents: number;
}

export function computeForecast(
  commitments: CommitmentInput[],
  heads: HeadInput[],
  adjustments: AdjustmentInput[],
): ProjectForecast {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const rows: CommitmentForecast[] = commitments.map((c) => {
    const committed = c.originalCents + c.approvedVariationCents;
    const costToComplete = Math.max(committed - c.claimedCents, 0);
    const adj = sum(
      adjustments.filter((a) => a.contractId === c.contractId).map((a) => a.amountCents),
    );
    return {
      contractId: c.contractId,
      committedCents: committed,
      claimedCents: c.claimedCents,
      costToCompleteCents: costToComplete,
      adjustmentsCents: adj,
      forecastFinalCents: c.claimedCents + costToComplete + adj,
      pendingVariationCents: c.pendingVariationCents,
    };
  });
  const known = new Set(commitments.map((c) => c.contractId));
  // An adjustment pointing at a contract that is not a live commitment still counts, at project level.
  const projectAdj = sum(
    adjustments
      .filter((a) => a.contractId === null || !known.has(a.contractId))
      .map((a) => a.amountCents),
  );
  const cost = sum(rows.map((r) => r.forecastFinalCents)) + projectAdj;
  const revenue = sum(heads.map((h) => h.originalCents + h.approvedVariationCents));
  const margin = revenue - cost;
  return {
    commitments: rows,
    committedCents: sum(rows.map((r) => r.committedCents)),
    claimedCents: sum(rows.map((r) => r.claimedCents)),
    costToCompleteCents: sum(rows.map((r) => r.costToCompleteCents)),
    projectAdjustmentsCents: projectAdj,
    forecastFinalCostCents: cost,
    pendingCostExposureCents: sum(rows.map((r) => r.pendingVariationCents)),
    revenueCents: revenue,
    billedCents: sum(heads.map((h) => h.claimedCents)),
    pendingRevenueCents: sum(heads.map((h) => h.pendingVariationCents)),
    forecastMarginCents: margin,
    forecastMarginPctHundredths: revenue > 0 ? Math.round((margin * 10_000) / revenue) : null,
  };
}
