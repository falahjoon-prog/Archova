import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { computeCashflow, type CashClaim, type CashflowInput } from '../domain/cashflow';
import { toCents } from '../domain/money';
import {
  contracts,
  directCosts,
  paymentClaims,
  payments,
  retentionReleases,
  retentionTerms,
} from '../infra/tables';
import type { BudgetService } from './budget';
import type { ForecastService } from './forecast';
import type { FinancialsDeps } from './financials';

const signedCents = (v: string) => (v.startsWith('-') ? -toCents(v.slice(1)) : toCents(v));
const pct = (v: string | null) => (v === null ? null : Number(v));

export interface CashflowDeps {
  access: AccessService;
  platform: FinancialsDeps['platform'];
  forecast: ForecastService;
  budget: BudgetService;
  now?: () => Date;
}

/**
 * Cashflow and WIP forecast (`GET .../cashflow`). Reads what the cost forecast, budget forecast and claims already
 * hold and hands it to the pure `computeCashflow`; nothing is stored. Builder staff only, like the cost forecast
 * it shows the margin of.
 */
export function createCashflowService(deps: CashflowDeps) {
  const now = deps.now ?? (() => new Date());

  async function cashflow(scope: TenantScope, projectId: string) {
    // The cost forecast checks `financials.forecast.read` and staff-only before anything else is read.
    const { result: cost, subs } = await deps.forecast.costForecast(scope, projectId);
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);

    const live = await scope.tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.projectId, projectId), ne(contracts.status, 'terminated')));
    const heads = live.filter((c) => c.kind === 'head');
    const head = heads[0];
    const headIds = heads.map((c) => c.id);
    const subIds = subs.map((c) => c.id);

    const claimRows = live.length
      ? await scope.tx
          .select()
          .from(paymentClaims)
          .where(
            and(
              inArray(
                paymentClaims.contractId,
                live.map((c) => c.id),
              ),
              eq(paymentClaims.isValid, true),
              ne(paymentClaims.status, 'withdrawn'),
            ),
          )
      : [];
    const paid = claimRows.filter((c) => c.status === 'paid').map((c) => c.id);
    const paidOn = paid.length
      ? await scope.tx
          .select({
            claimId: payments.claimId,
            last: sql<string>`max(${payments.paidOn})`,
          })
          .from(payments)
          .where(and(inArray(payments.claimId, paid), sql`${payments.reversesPaymentId} is null`))
          .groupBy(payments.claimId)
      : [];
    const paidMonth = new Map(paidOn.map((p) => [p.claimId, String(p.last).slice(0, 7)]));
    const toClaim = (c: (typeof claimRows)[number]): CashClaim => ({
      number: c.number,
      status: c.status,
      netCents: toCents(c.claimedNet),
      retentionCents: toCents(c.retention),
      paidMonth: c.status === 'paid' ? (paidMonth.get(c.id) ?? c.periodEnd.slice(0, 7)) : null,
      dueOn: c.paymentDueOn,
      periodEnd: c.periodEnd,
    });

    const terms = headIds.length
      ? await scope.tx
          .select()
          .from(retentionTerms)
          .where(
            and(
              eq(retentionTerms.projectId, projectId),
              inArray(retentionTerms.contractId, headIds),
            ),
          )
      : [];
    const released = headIds.length
      ? await scope.tx
          .select({ stage: retentionReleases.stage, amount: retentionReleases.amount })
          .from(retentionReleases)
          .where(
            and(
              eq(retentionReleases.projectId, projectId),
              inArray(retentionReleases.contractId, headIds),
            ),
          )
      : [];
    const t = terms.find((x) => x.contractId === head?.id);

    const direct = await scope.tx
      .select({
        month: sql<string>`to_char(${directCosts.incurredOn}, 'YYYY-MM')`,
        total: sql<string>`coalesce(sum(${directCosts.amount}), 0)`,
      })
      .from(directCosts)
      .where(and(eq(directCosts.projectId, projectId), eq(directCosts.status, 'recorded')))
      .groupBy(sql`to_char(${directCosts.incurredOn}, 'YYYY-MM')`);

    // The team's own monthly cost plan; margin lines are not cash out.
    const plan = await deps.budget.forecast(scope, projectId);
    const byMonth = new Map<string, number>();
    let unscheduled = 0;
    for (const l of plan.lines) {
      if (l.line.isMargin) continue;
      for (const [m, v] of Object.entries(l.entries))
        byMonth.set(m, (byMonth.get(m) ?? 0) + signedCents(v));
      unscheduled += Math.max(signedCents(l.unscheduled), 0);
    }

    const subDays = subs.filter((c) => c.paymentDays !== null).map((c) => c.paymentDays as number);
    const lagDays = subDays.length ? subDays.reduce((n, d) => n + d, 0) / subDays.length : 30;

    const input: CashflowInput = {
      today,
      head: head
        ? {
            revenueCents: cost.revenueCents,
            billedGrossCents: cost.billedCents,
            retentionPct: Number(head.retentionPct),
            retentionCapPct: pct(head.retentionCapPct),
            paymentDays: head.paymentDays ?? 30,
            retentionReleasedCents: released.reduce((n, r) => n + toCents(r.amount), 0),
            pcReleased: released.some((r) => r.stage === 'practical_completion'),
            practicalCompletionOn: t?.practicalCompletionOn ?? null,
            defectsPeriodDays: t?.defectsPeriodDays ?? null,
            firstReleasePct: Number(t?.firstReleasePct ?? 50),
          }
        : null,
      headClaims: claimRows.filter((c) => headIds.includes(c.contractId)).map(toClaim),
      subClaims: claimRows.filter((c) => subIds.includes(c.contractId)).map(toClaim),
      directCosts: direct.map((d) => ({ month: d.month, cents: toCents(d.total) })),
      costPlan: [...byMonth].map(([month, cents]) => ({ month, cents })),
      unscheduledCostCents: unscheduled,
      payLagMonths: Math.max(Math.round(lagDays / 30), 0),
      costToDateCents: cost.claimedCents + cost.directCostsCents,
      estimatedFinalCostCents: cost.forecastFinalCostCents,
    };
    return { today, ...computeCashflow(input) };
  }

  return { cashflow };
}

export type CashflowService = ReturnType<typeof createCashflowService>;
