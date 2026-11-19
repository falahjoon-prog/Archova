import { decodeId } from '@archova/domain';
import { AppError, defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { CashflowService } from '../application/cashflow';
import { fromCents } from '../domain/money';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};

export function cashflowRoutes(database: Database, cashflow: CashflowService) {
  return defineRoutes({
    getProjectCashflow: async (input) => {
      const r = await database.withTenantTx(
        requireTenant(input),
        (s) => cashflow.cashflow(s, project(input.params)),
        { readOnly: true },
      );
      const w = r.wip;
      return {
        status: 200,
        body: {
          asOf: r.today,
          months: r.months.map((m) => ({
            month: m.month,
            kind: m.kind,
            cashIn: fromCents(m.cashInCents),
            cashOut: fromCents(m.cashOutCents),
            net: fromCents(m.netCents),
            cumulative: fromCents(m.cumulativeCents),
          })),
          totals: {
            cashInToDate: fromCents(r.totals.cashInToDateCents),
            cashOutToDate: fromCents(r.totals.cashOutToDateCents),
            forecastCashIn: fromCents(r.totals.forecastCashInCents),
            forecastCashOut: fromCents(r.totals.forecastCashOutCents),
            lowestCumulative: fromCents(r.totals.lowestCumulativeCents),
            lowestMonth: r.totals.lowestMonth,
          },
          wip: w
            ? {
                contractValue: fromCents(w.contractValueCents),
                estimatedFinalCost: fromCents(w.estimatedFinalCostCents),
                costToDate: fromCents(w.costToDateCents),
                percentComplete: (w.percentCompleteHundredths / 100).toFixed(2),
                earnedRevenue: fromCents(w.earnedRevenueCents),
                billed: fromCents(w.billedCents),
                overUnderBilled: fromCents(w.overUnderBilledCents),
                earnedGrossProfit: fromCents(w.earnedGrossProfitCents),
                projectedGrossProfit: fromCents(w.projectedGrossProfitCents),
                receivableOpen: fromCents(w.receivableOpenCents),
                retentionHeld: fromCents(w.retentionHeldCents),
              }
            : null,
          flags: r.flags.map((f) => ({
            code: f.code,
            severity: f.severity,
            title: f.title,
            detail: f.detail,
            month: f.month ?? null,
            amount: f.amountCents === undefined ? null : fromCents(f.amountCents),
          })),
        },
      };
    },
  });
}
