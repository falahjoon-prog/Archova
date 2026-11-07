import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { percentOf, toCents } from '../domain/money';
import type { ReleaseStage } from '../domain/release';
import type { ReminderContract } from '../domain/reminders';
import {
  contracts,
  paymentClaims,
  paymentSchedules,
  payments,
  retentionReleases,
  retentionTerms,
  trustAccounts,
  trustMovements,
} from '../infra/tables';

const hundredths = (pct: string) => Math.round(Number(pct) * 100);
const signedCents = (amount: string) =>
  amount.startsWith('-') ? -toCents(amount.slice(1)) : toCents(amount);

/**
 * Live contracts that have withheld retention, with what the reminder planner needs: the trust account and its
 * movements, the release terms and what has been released. Contracts without a creator are skipped (nobody to tell).
 */
export async function findReminderContracts(scope: TenantScope): Promise<ReminderContract[]> {
  const rows = await scope.tx
    .select()
    .from(contracts)
    .where(and(ne(contracts.status, 'terminated'), isNotNull(contracts.createdBy)))
    .limit(5000);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [withheld, accounts, terms, releases, claimRows] = await Promise.all([
    scope.tx
      .select({
        contractId: paymentClaims.contractId,
        total: sql<string>`coalesce(sum(${paymentClaims.retention}), 0)`,
      })
      .from(paymentClaims)
      .where(and(inArray(paymentClaims.contractId, ids), eq(paymentClaims.isValid, true)))
      .groupBy(paymentClaims.contractId),
    scope.tx.select().from(trustAccounts).where(inArray(trustAccounts.contractId, ids)),
    scope.tx.select().from(retentionTerms).where(inArray(retentionTerms.contractId, ids)),
    scope.tx.select().from(retentionReleases).where(inArray(retentionReleases.contractId, ids)),
    scope.tx
      .select({
        id: paymentClaims.id,
        contractId: paymentClaims.contractId,
        number: paymentClaims.number,
        paymentDueOn: paymentClaims.paymentDueOn,
        scheduled: paymentSchedules.scheduledAmount,
      })
      .from(paymentClaims)
      .innerJoin(paymentSchedules, eq(paymentSchedules.claimId, paymentClaims.id))
      .where(
        and(
          inArray(paymentClaims.contractId, ids),
          eq(paymentClaims.isValid, true),
          isNotNull(paymentClaims.paymentDueOn),
        ),
      ),
  ]);
  const paidRows = claimRows.length
    ? await scope.tx
        .select({
          claimId: payments.claimId,
          total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(
          inArray(
            payments.claimId,
            claimRows.map((q) => q.id),
          ),
        )
        .groupBy(payments.claimId)
    : [];
  const paidBy = new Map(paidRows.map((p) => [p.claimId, signedCents(p.total)]));
  const held = new Map(withheld.map((w) => [w.contractId, toCents(w.total)]));
  const acctByContract = new Map(accounts.map((a) => [a.contractId, a]));
  const movements = accounts.length
    ? await scope.tx
        .select()
        .from(trustMovements)
        .where(
          inArray(
            trustMovements.trustAccountId,
            accounts.map((a) => a.id),
          ),
        )
    : [];
  const termsByContract = new Map(terms.map((t) => [t.contractId, t]));

  const out: ReminderContract[] = [];
  for (const c of rows) {
    const retentionWithheldCents = held.get(c.id) ?? 0;
    const unpaidClaims = claimRows
      .filter((q) => q.contractId === c.id)
      .map((q) => {
        const scheduled = toCents(q.scheduled);
        // The schedule is ex GST and after retention; GST is 10% of it (the payee view uses the same rule).
        const due = scheduled + percentOf(scheduled, 1000);
        return {
          claimId: q.id,
          number: q.number,
          paymentDueOn: q.paymentDueOn!,
          outstandingCents: due - (paidBy.get(q.id) ?? 0),
        };
      })
      .filter((q) => q.outstandingCents > 0);
    if (retentionWithheldCents <= 0 && unpaidClaims.length === 0) continue;
    const acct = acctByContract.get(c.id);
    const t = termsByContract.get(c.id);
    const releasedByStage: Partial<Record<ReleaseStage, number>> = {};
    for (const r of releases)
      if (r.contractId === c.id)
        releasedByStage[r.stage] = (releasedByStage[r.stage] ?? 0) + toCents(r.amount);
    out.push({
      contractId: c.id,
      projectId: c.projectId,
      ownerUserId: c.createdBy!,
      number: c.number,
      title: c.title,
      sopaState: c.sopaState,
      valueCents: toCents(c.originalValue),
      governmentClient: acct?.governmentClient ?? false,
      trustSetUp: acct !== undefined && acct.institution !== null,
      retentionWithheldCents,
      movements: movements
        .filter((m) => acct !== undefined && m.trustAccountId === acct.id)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          amountCents: signedCents(m.amount),
          reversesMovementId: m.reversesMovementId,
        })),
      terms: {
        firstReleasePctHundredths: hundredths(t?.firstReleasePct ?? '50'),
        practicalCompletionOn: t?.practicalCompletionOn ?? null,
        defectsPeriodDays: t?.defectsPeriodDays ?? null,
      },
      releasedByStage,
      unpaidClaims,
    });
  }
  return out;
}
