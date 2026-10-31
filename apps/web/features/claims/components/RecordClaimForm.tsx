'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, TextField } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { zonedToUtc } from '@archova/time';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ContractDetail } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { cents } from '../lib/money';

/**
 * Records a payment claim against the schedule of values (CLM-US4). The time it reached the nominated service
 * address starts the clock, so it is asked for in the project's time zone and never taken from an email's Date header.
 */
export function RecordClaimForm({ detail }: { detail: ContractDetail }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  const { submitClaim } = useClaimsMutations(project.projectId);
  const today = todayIn(project.timezone);
  const [periodEnd, setPeriodEnd] = useState('');
  const [receivedDate, setReceivedDate] = useState(today);
  const [receivedTime, setReceivedTime] = useState('09:00');
  const [statesAct, setStatesAct] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = detail.sov
      .map((s) => ({ sovItemId: s.id, thisClaim: (amounts[s.id] ?? '').trim() }))
      .filter((l) => l.thisClaim !== '' && l.thisClaim !== '0' && l.thisClaim !== '0.00');
    if (!periodEnd) return setError('Enter the date the claim period ends.');
    if (!receivedDate || !receivedTime) return setError('Enter when the claim was received.');
    if (lines.length === 0) return setError('Claim an amount against at least one line.');
    if (lines.some((l) => cents(l.thisClaim) === null))
      return setError('Enter each amount as a dollar amount, like 12500.00.');
    submitClaim.mutate(
      {
        contractId: detail.contract.id,
        body: {
          periodEnd,
          receivedAt: zonedToUtc(receivedDate, receivedTime, project.timezone).toISOString(),
          statesAct,
          lines,
        },
      },
      {
        onSuccess: (d) =>
          router.push(webRoutes.paymentClaim(org.orgSlug, project.projectId, d.claim.id)),
      },
    );
  }

  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      <div className="form-row">
        <TextField
          label="Claim period ends"
          type="date"
          required
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
        />
        <TextField
          label="Received on"
          type="date"
          required
          value={receivedDate}
          onChange={(e) => setReceivedDate(e.target.value)}
        />
        <TextField
          label="Received at"
          type="time"
          required
          value={receivedTime}
          hint={`Time at the nominated service address, in ${project.timezone}.`}
          onChange={(e) => setReceivedTime(e.target.value)}
        />
      </div>
      <Checkbox
        label="The claim says it is made under the Security of Payment Act"
        checked={statesAct}
        onChange={(e) => setStatesAct(e.target.checked)}
      />
      <fieldset className="stack">
        <legend>Amounts claimed this period (ex GST)</legend>
        {detail.sov.map((s) => (
          <TextField
            key={s.id}
            label={`${s.code} ${s.description}`}
            hint={`Line value ${s.value}`}
            inputMode="decimal"
            value={amounts[s.id] ?? ''}
            onChange={(e) => setAmounts((a) => ({ ...a, [s.id]: e.target.value }))}
          />
        ))}
      </fieldset>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={submitClaim.error} title="We couldn't record this claim" />
      <div className="row-actions">
        <Button type="submit" disabled={submitClaim.isPending}>
          {submitClaim.isPending ? 'Recording…' : 'Record payment claim'}
        </Button>
      </div>
    </form>
  );
}
