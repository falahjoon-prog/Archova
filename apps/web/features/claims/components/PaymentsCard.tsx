'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ClaimPayment, PaymentClaimDetail } from '../data/api';
import { useClaimPayments, usePaymentMutations } from '../hooks/useClaims';
import { cents, aud } from '../lib/money';

/**
 * Money paid against a claim, recorded by hand (the accounting sync records its own). Shown once a payment schedule
 * is issued. Reversing a payment adds a matching negative line dated today; nothing is edited or deleted.
 */
export function PaymentsCard({
  detail,
  canRecord,
}: {
  detail: PaymentClaimDetail;
  canRecord: boolean;
}) {
  const project = useCurrentProject();
  const q = useClaimPayments(project.projectId, detail.claim.id);
  const { record, reverse } = usePaymentMutations(project.projectId, detail.claim.id);
  const today = todayIn(project.timezone);
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!detail.schedule) return null;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn’t load the payments" />;
  const data = q.data;

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const c = cents(amount);
    if (c === null || c <= 0) return setError('Enter the amount paid, in dollars and cents.');
    if (!paidOn || paidOn > today) return setError('Enter the day it was paid, not a future day.');
    if (!reference.trim()) return setError('Enter a reference, such as the remittance number.');
    record.mutate(
      { paidOn, amount: amount.trim(), reference: reference.trim() },
      {
        onSuccess: () => {
          setAmount('');
          setReference('');
        },
      },
    );
  }

  const reversed = new Set(
    (data?.payments ?? []).map((p) => p.reversesPaymentId).filter((id): id is string => !!id),
  );
  const columns: DataTableColumn<ClaimPayment>[] = [
    { id: 'paidOn', header: 'Paid', rowHeader: true, cell: (p) => formatLocalDate(p.paidOn) },
    { id: 'reference', header: 'Reference', cell: (p) => p.reference },
    {
      id: 'amount',
      header: 'Amount',
      align: 'end',
      cell: (p) => <span className="u-mono">{aud(p.amount)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: (p) =>
        canRecord && p.source === 'manual' && !p.reversesPaymentId && !reversed.has(p.id) ? (
          <Button
            variant="secondary"
            disabled={reverse.isPending}
            aria-label={`Reverse payment ${p.reference}`}
            onClick={() => reverse.mutate(p.id)}
          >
            Reverse
          </Button>
        ) : null,
    },
  ];

  return (
    <Card title="Payments">
      {data ? (
        <DescriptionList
          items={[
            {
              label: 'Due (incl GST)',
              value: data.amountDue ? aud(data.amountDue) : '—',
              mono: true,
            },
            { label: 'Paid', value: aud(data.paid), mono: true },
            {
              label: 'Outstanding',
              value: data.outstanding ? aud(data.outstanding) : '—',
              mono: true,
            },
          ]}
        />
      ) : null}
      {data && data.payments.length > 0 ? (
        <DataTable
          caption="Payments recorded"
          columns={columns}
          rows={data.payments}
          getRowId={(p) => p.id}
        />
      ) : null}
      <ErrorAlert error={reverse.error} title="We couldn’t reverse the payment" />
      {canRecord ? (
        <form className="stack-lg" onSubmit={save} noValidate>
          <TextField
            label="Paid on"
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
          <TextField
            label="Amount paid (incl GST)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label="Reference"
            value={reference}
            maxLength={100}
            onChange={(e) => setReference(e.target.value)}
          />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ErrorAlert error={record.error} title="We couldn’t record the payment" />
          <div className="row-actions">
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Saving…' : 'Record payment'}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
