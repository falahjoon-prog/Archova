'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentClaimDetail } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { aud, cents } from '../lib/money';

/**
 * Issues the payment schedule (CLM-US7, CLM-US10). Scheduling less than the claim needs a reason, and an issued
 * schedule cannot be changed, so the form says so before the button is pressed.
 */
export function IssueScheduleForm({ detail }: { detail: PaymentClaimDetail }) {
  const project = useCurrentProject();
  const { issueSchedule } = useClaimsMutations(project.projectId);
  const claim = detail.claim;
  const [amount, setAmount] = useState(claim.claimedNet);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const claimed = cents(claim.claimedNet) ?? 0;
  const scheduled = cents(amount);
  const withheld = scheduled === null ? null : claimed - scheduled;

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (scheduled === null)
      return setError('Enter the scheduled amount as a dollar amount, like 12500.00.');
    if (scheduled > claimed)
      return setError(
        `A payment schedule can't be for more than the claim (${aud(claim.claimedNet)}).`,
      );
    if (scheduled < claimed && !reason.trim())
      return setError(
        'Give the reasons for the reduction. The Act requires them, and you can’t add new ones later.',
      );
    issueSchedule.mutate({
      claimId: claim.id,
      body: {
        scheduledAmount: amount.trim(),
        ...(reason.trim() ? { overallReason: reason.trim() } : {}),
      },
    });
  }

  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      <TextField
        label="Scheduled amount (ex GST)"
        inputMode="decimal"
        value={amount}
        hint={`Claimed ${aud(claim.claimedNet)} ex GST, after retention.`}
        onChange={(e) => setAmount(e.target.value)}
      />
      {withheld !== null && withheld > 0 ? (
        <Textarea
          label="Reasons for the reduction"
          required
          value={reason}
          hint={`${aud((withheld / 100).toFixed(2))} withheld. Say why for each part you are not paying.`}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      <Alert tone="warning" title="This can't be undone">
        Once issued, the payment schedule is locked as a record of what you gave and when.
      </Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={issueSchedule.error} title="We couldn't issue this schedule" />
      <div className="row-actions">
        <Button type="submit" disabled={issueSchedule.isPending}>
          {issueSchedule.isPending ? 'Issuing…' : 'Issue payment schedule'}
        </Button>
      </div>
    </form>
  );
}
