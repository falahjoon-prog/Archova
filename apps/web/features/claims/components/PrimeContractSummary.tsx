'use client';

import { NovaSuggestion, StatGrid, type StatItem } from '@archova/ui';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Contract, PaymentClaim } from '../data/api';
import { useContracts, usePaymentSummary, useVariations } from '../hooks/useClaims';
import {
  agingVariations,
  AGING_VARIATION_DAYS,
  fromCents,
  rollupPrime,
  rollupSubcontracts,
} from '../lib/prime';
import { aud } from '../lib/money';

/**
 * The head of a prime contract in one place: contract sum with approved variations, claimed to date, what is paid
 * and owing, subcontracts against it, and a Nova flag when variations have waited too long for a decision.
 */
export function PrimeContractSummary({
  contract,
  claims,
}: {
  contract: Contract;
  claims: readonly PaymentClaim[];
}) {
  const project = useCurrentProject();
  const variations = useVariations(project.projectId, contract.id);
  const payments = usePaymentSummary(project.projectId, contract.id);
  const contracts = useContracts(project.projectId);
  const today = todayIn(project.timezone);

  const vars = variations.data?.data ?? [];
  const r = rollupPrime(contract, vars, claims);
  const aging = agingVariations(vars, today, project.timezone);
  const subs = contracts.data ? rollupSubcontracts(contracts.data, r.revised) : null;
  const owing = payments.data
    ? payments.data.claims.reduce((n, c) => n + Math.round(Number(c.outstanding) * 100), 0)
    : null;
  const overdue = payments.data?.claims.filter((c) => c.overdue).length ?? 0;

  const items: StatItem[] = [
    {
      label: 'Revised contract (ex GST)',
      value: aud(fromCents(r.revised)),
      hint: `Original ${aud(contract.originalValue)}`,
    },
    {
      label: 'Approved variations',
      value: aud(fromCents(r.approvedVariations)),
      hint: r.pendingCount
        ? `${r.pendingCount} awaiting decision (${aud(fromCents(r.pendingVariations))})`
        : 'None awaiting decision',
    },
    {
      label: 'Claimed to date',
      value: aud(fromCents(r.claimedToDate)),
      hint: `${r.percentClaimed}% of revised, ${aud(fromCents(r.remainingToClaim))} left`,
      ...(r.percentClaimed > 100 ? { tone: 'danger' as const } : {}),
    },
    {
      label: 'Paid (inc GST)',
      value: payments.data ? aud(payments.data.totalPaid) : '…',
      hint:
        owing === null
          ? undefined
          : `${aud(fromCents(owing))} outstanding${overdue ? `, ${overdue} overdue` : ''}`,
      ...(overdue ? { tone: 'danger' as const } : {}),
    },
  ];
  if (subs && subs.count > 0) {
    items.push({
      label: 'Subcontracts against it',
      value: aud(fromCents(subs.committed)),
      hint: `${subs.count} subcontract${subs.count === 1 ? '' : 's'}, ${aud(fromCents(subs.retained))} (${subs.marginPct}%) before own costs`,
      ...(subs.retained < 0 ? { tone: 'danger' as const } : {}),
    });
  }

  return (
    <section className="stack-lg" aria-label="Contract summary">
      <StatGrid items={items} />
      {aging.length > 0 ? (
        <NovaSuggestion title={`Variations waiting ${AGING_VARIATION_DAYS}+ days for a decision`}>
          <p className="u-m-0">
            {aging.length} unexecuted variation{aging.length === 1 ? ' has' : 's have'} been
            waiting, together{' '}
            {aud(
              fromCents(
                aging.reduce((n, a) => n + Math.round(Number(a.variation.amount) * 100), 0),
              ),
            )}
            . They cannot be claimed until approved.
          </p>
          <ul>
            {aging.map(({ variation: v, days }) => (
              <li key={v.id}>
                Variation {v.number}, {v.title}: {aud(v.amount)}, submitted{' '}
                {formatLocalDate(todayIn(project.timezone, new Date(v.submittedAt as string)))} (
                {days} days)
              </li>
            ))}
          </ul>
        </NovaSuggestion>
      ) : null}
    </section>
  );
}
