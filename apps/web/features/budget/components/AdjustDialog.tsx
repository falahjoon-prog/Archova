'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, SkeletonRows, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetLine } from '../data/api';
import { useAdjustments, useBudgetMutations } from '../hooks/useBudget';
import { aud, isNegative, parseSignedAmount } from '../lib/money';

/**
 * History of one locked line plus the form for the next adjustment. History is append-only: an adjustment is a signed
 * amount with a reason, and a mistake is corrected with another adjustment, never by editing an old one.
 */
export function AdjustDialog({
  line,
  canManage,
  onClose,
}: {
  line: BudgetLine;
  canManage: boolean;
  onClose: () => void;
}) {
  const project = useCurrentProject();
  const history = useAdjustments(project.projectId, line.id);
  const { adjust } = useBudgetMutations(project.projectId);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const signed = parseSignedAmount(amount);
    if (!signed) return setError('Enter a dollar amount that is not zero, like 2500 or -1500.');
    if (!reason.trim()) return setError('Give the reason for this change.');
    if (Number(line.revised) + Number(signed) < 0)
      return setError('This would take the line below zero.');
    adjust.mutate(
      { lineId: line.id, body: { amount: signed, reason: reason.trim() } },
      {
        onSuccess: () => {
          setAmount('');
          setReason('');
        },
      },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${line.code} ${line.codeDescription}`}
      description={`Original ${aud(line.original)}, revised ${aud(line.revised)}.`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        <h3 className="u-m-0">Adjustment history</h3>
        <ErrorAlert error={history.error} title="We couldn't load the history" />
        {history.isPending ? (
          <SkeletonRows label="Loading history…" />
        ) : history.data && history.data.length > 0 ? (
          <ul className="stack u-m-0" aria-label="Adjustments, newest first">
            {[...history.data]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((a) => (
                <li key={a.id}>
                  <strong className="u-mono">{aud(a.amount)}</strong>{' '}
                  <span className="u-caption">
                    {isNegative(a.amount) ? 'decrease' : 'increase'}
                  </span>
                  <p className="u-m-0">{a.reason}</p>
                  <p className="u-m-0 u-caption">{formatInstant(a.createdAt, project.timezone)}</p>
                </li>
              ))}
          </ul>
        ) : history.data ? (
          <p className="u-m-0">No adjustments yet.</p>
        ) : null}
        {canManage ? (
          <form className="stack" onSubmit={save} noValidate>
            <h3 className="u-m-0">Adjust this line</h3>
            <TextField
              label="Change (AUD ex GST)"
              inputMode="decimal"
              hint="Use a minus sign to reduce the line."
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Textarea
              label="Reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <ErrorAlert error={adjust.error} title="We couldn't save the adjustment" />
            <Button type="submit" loading={adjust.isPending}>
              Record adjustment
            </Button>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}
