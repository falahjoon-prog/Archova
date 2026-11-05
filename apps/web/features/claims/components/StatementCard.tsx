'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentClaimDetail } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';

/**
 * The NSW subcontractor's statement for this claim (compliance/05 §6). Missing is a prompt, not a gate: the claim
 * and the payment schedule go ahead, and nothing here suggests withholding payment (an open question for the lawyer).
 */
export function StatementCard({
  detail,
  canRecord,
}: {
  detail: PaymentClaimDetail;
  canRecord: boolean;
}) {
  const project = useCurrentProject();
  const { recordStatement } = useClaimsMutations(project.projectId);
  const s = detail.statement;
  const missing = detail.warnings.includes('subcontractor_statement_missing');
  const [editing, setEditing] = useState(false);
  const [periodEnd, setPeriodEnd] = useState(s?.periodEnd ?? detail.claim.periodEnd);
  const [receivedOn, setReceivedOn] = useState(s?.receivedOn ?? '');
  const [signedOn, setSignedOn] = useState(s?.signedOn ?? '');
  const [note, setNote] = useState(s?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!s && !missing) return null;

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!periodEnd || !receivedOn)
      return setError('Enter the period the statement covers and the day it arrived.');
    if (signedOn && signedOn > receivedOn)
      return setError('The statement can’t be signed after it arrived.');
    recordStatement.mutate(
      {
        claimId: detail.claim.id,
        body: {
          periodEnd,
          receivedOn,
          ...(signedOn ? { signedOn } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <Card title="Subcontractor’s statement">
      {missing ? (
        <Alert tone="warning" title="No subcontractor’s statement linked to this claim">
          NSW subcontract claims come with a statement for the claim period. Link it here once you
          have it. This does not stop the claim or the payment schedule.
        </Alert>
      ) : null}
      {s && !editing ? (
        <p>
          Covers the period to {formatLocalDate(s.periodEnd)}, received{' '}
          {formatLocalDate(s.receivedOn)}
          {s.signedOn ? `, signed ${formatLocalDate(s.signedOn)}` : ''}.{s.note ? ` ${s.note}` : ''}
        </p>
      ) : null}
      {canRecord && !editing ? (
        <div className="row-actions">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {s ? 'Change the statement' : 'Link the statement'}
          </Button>
        </div>
      ) : null}
      {canRecord && editing ? (
        <form className="stack-lg" onSubmit={save} noValidate>
          <TextField
            label="Period ends"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
          <TextField
            label="Received on"
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
          <TextField
            label="Signed on (optional)"
            type="date"
            value={signedOn}
            onChange={(e) => setSignedOn(e.target.value)}
          />
          <TextField
            label="Note (optional)"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ErrorAlert error={recordStatement.error} title="We couldn’t link the statement" />
          <div className="row-actions">
            <Button type="submit" disabled={recordStatement.isPending}>
              {recordStatement.isPending ? 'Saving…' : 'Save statement'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
