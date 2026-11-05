import { encodeId } from '@archova/domain';
import type { AdjustmentRow, ForecastService } from '../application/forecast';
import { fromCents } from '../domain/money';

export const toAdjustmentDto = (a: AdjustmentRow) => ({
  id: encodeId('forecastAdjustment', a.id),
  contractId: a.contractId ? encodeId('contract', a.contractId) : null,
  costCodeId: a.costCodeId ? encodeId('costCode', a.costCodeId) : null,
  category: a.category,
  label: a.label,
  note: a.note,
  amount: a.amount,
  createdAt: a.createdAt.toISOString(),
});

export function toForecastDto(d: Awaited<ReturnType<ForecastService['costForecast']>>) {
  const r = d.result;
  return {
    revenue: fromCents(r.revenueCents),
    billedToDate: fromCents(r.billedCents),
    pendingRevenueVariations: fromCents(r.pendingRevenueCents),
    committed: fromCents(r.committedCents),
    claimedToDate: fromCents(r.claimedCents),
    costToComplete: fromCents(r.costToCompleteCents),
    projectAdjustments: fromCents(r.projectAdjustmentsCents),
    forecastFinalCost: fromCents(r.forecastFinalCostCents),
    pendingCostVariations: fromCents(r.pendingCostExposureCents),
    forecastMargin: fromCents(r.forecastMarginCents),
    forecastMarginPct:
      r.forecastMarginPctHundredths === null
        ? null
        : (r.forecastMarginPctHundredths / 100).toFixed(2),
    commitments: r.commitments.map((c) => {
      const contract = d.subs.find((s) => s.id === c.contractId)!;
      return {
        contractId: encodeId('contract', c.contractId),
        number: contract.number,
        title: contract.title,
        committed: fromCents(c.committedCents),
        claimedToDate: fromCents(c.claimedCents),
        costToComplete: fromCents(c.costToCompleteCents),
        adjustments: fromCents(c.adjustmentsCents),
        forecastFinal: fromCents(c.forecastFinalCents),
        pendingVariations: fromCents(c.pendingVariationCents),
      };
    }),
    adjustments: d.adjustments.map(toAdjustmentDto),
  };
}
