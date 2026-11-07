'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  StatGrid,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ChangeOrder, Payment } from '../data/api';
import {
  useChangeOrders,
  useCommitment,
  useCommitmentMutations,
  usePayments,
} from '../hooks/useCommitments';
import { aud, parseAmount, parseSignedAmount, percentOf, sumAmounts } from '../lib/money';
import { STATUS } from './CommitmentsScreen';

const CO_TONE = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
} as const;
const CO_LABEL = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

/** One commitment: its value, change orders and payments. */
export function CommitmentScreen({ commitmentId }: { commitmentId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'commitment', id: commitmentId },
  });
  const detail = useCommitment(project.projectId, commitmentId);
  const cos = useChangeOrders(project.projectId, commitmentId);
  const pays = usePayments(project.projectId, commitmentId);
  const m = useCommitmentMutations(project.projectId, commitmentId);
  const [reason, setReason] = useState<{ kind: 'reject' | 'void'; id: string } | null>(null);
  const [note, setNote] = useState('');

  const c = detail.data?.commitment;
  const lines = detail.data?.lines ?? [];
  const approvedCos = (cos.data ?? []).filter((x) => x.status === 'approved');
  const changes = sumAmounts(...approvedCos.map((x) => x.amount));
  const revised = c ? sumAmounts(c.total, changes) : '0.00';
  const paid = sumAmounts(
    ...(pays.data ?? []).filter((p) => p.status === 'recorded').map((p) => p.amount),
  );
  const approved = c?.status === 'approved';

  const coColumns: DataTableColumn<ChangeOrder>[] = [
    {
      id: 'n',
      header: 'No.',
      rowHeader: true,
      cell: (x) => `CCO-${String(x.number).padStart(3, '0')}`,
    },
    { id: 'title', header: 'Change order', cell: (x) => x.title },
    {
      id: 'status',
      header: 'Status',
      cell: (x) => <StatusPill tone={CO_TONE[x.status]}>{CO_LABEL[x.status]}</StatusPill>,
    },
    {
      id: 'amount',
      header: 'Amount (ex GST)',
      align: 'end',
      sortValue: (x) => Number(x.amount),
      cell: (x) => <span className="u-mono u-nowrap">{aud(x.amount)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (x) => (
        <span className="row-actions">
          {x.status === 'draft' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => m.moveChangeOrder.mutate({ changeOrderId: x.id, to: 'submit' })}
            >
              Submit CCO-{String(x.number).padStart(3, '0')}
            </Button>
          ) : null}
          {x.status === 'submitted' ? (
            <>
              <Button
                size="sm"
                onClick={() => m.moveChangeOrder.mutate({ changeOrderId: x.id, to: 'approve' })}
              >
                Approve CCO-{String(x.number).padStart(3, '0')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReason({ kind: 'reject', id: x.id })}
              >
                Reject CCO-{String(x.number).padStart(3, '0')}
              </Button>
            </>
          ) : null}
          {x.decisionNote ? <span className="u-caption">{x.decisionNote}</span> : null}
        </span>
      ),
    },
  ];
  const payColumns: DataTableColumn<Payment>[] = [
    {
      id: 'n',
      header: 'No.',
      rowHeader: true,
      cell: (p) => `PAY-${String(p.number).padStart(3, '0')}`,
    },
    { id: 'date', header: 'Paid on', cell: (p) => formatLocalDate(p.paidOn) },
    { id: 'ref', header: 'Reference', cell: (p) => p.reference ?? '' },
    {
      id: 'status',
      header: 'Status',
      cell: (p) =>
        p.status === 'void' ? (
          <StatusPill tone="neutral">Voided</StatusPill>
        ) : (
          <StatusPill tone="success">Recorded</StatusPill>
        ),
    },
    {
      id: 'amount',
      header: 'Amount (ex GST)',
      align: 'end',
      cell: (p) => <span className="u-mono u-nowrap">{aud(p.amount)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (p) =>
        p.status === 'recorded' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setReason({ kind: 'void', id: p.id })}
          >
            Void PAY-{String(p.number).padStart(3, '0')}
          </Button>
        ) : (
          <span className="u-caption">{p.voidReason}</span>
        ),
    },
  ];

  function confirmReason(e: FormEvent) {
    e.preventDefault();
    if (!reason || !note.trim()) return;
    const done = {
      onSuccess: () => {
        setReason(null);
        setNote('');
      },
    };
    if (reason.kind === 'reject')
      m.moveChangeOrder.mutate({ changeOrderId: reason.id, to: 'reject', note: note.trim() }, done);
    else m.voidPayment.mutate({ paymentId: reason.id, note: note.trim() }, done);
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title={c ? `C-${String(c.number).padStart(4, '0')} ${c.title}` : 'Commitment'}
        description={c ? STATUS[c.status].label : undefined}
        actions={
          <Link className="link" href={webRoutes.commitments(org.orgSlug, project.projectId)}>
            All commitments
          </Link>
        }
      />
      <ErrorAlert
        error={detail.error ?? cos.error ?? pays.error}
        title="We couldn't load this commitment"
      />
      {c ? (
        <StatGrid
          items={[
            { label: 'Original', value: aud(c.total), hint: `${lines.length} lines` },
            { label: 'Approved change orders', value: aud(changes) },
            { label: 'Revised value', value: aud(revised) },
            { label: 'Paid', value: aud(paid), hint: `${percentOf(paid, revised)}% paid` },
            { label: 'Left to pay', value: aud(sumAmounts(revised, `-${paid}`)) },
          ]}
        />
      ) : null}

      <ErrorAlert error={m.moveChangeOrder.error} title="We couldn't update that change order" />
      <DataTable
        caption="Change orders"
        columns={coColumns}
        rows={cos.data ?? []}
        getRowId={(x) => x.id}
        empty={
          <EmptyState
            title="No change orders"
            description="A change order raises or lowers the value of an approved commitment."
          />
        }
      />
      <ErrorAlert error={m.voidPayment.error} title="We couldn't void that payment" />
      <DataTable
        caption="Payments"
        columns={payColumns}
        rows={pays.data ?? []}
        getRowId={(p) => p.id}
        empty={<EmptyState title="No payments" description="Payments to the vendor appear here." />}
      />
      {reason ? (
        <Card title={reason.kind === 'reject' ? 'Reject change order' : 'Void payment'}>
          <form className="stack-lg" noValidate onSubmit={confirmReason}>
            <Textarea
              label="Reason"
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row-actions">
              <Button type="submit" disabled={!note.trim()}>
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => setReason(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {approved ? (
        <div className="stack-lg">
          <NewChangeOrder commitmentId={commitmentId} lines={lines} />
          <NewPayment commitmentId={commitmentId} />
        </div>
      ) : c ? (
        <Alert tone="info">
          Change orders and payments open up once the commitment is approved.
        </Alert>
      ) : null}
    </div>
  );
}

function NewChangeOrder({
  commitmentId,
  lines,
}: {
  commitmentId: string;
  lines: { budgetLineId: string; description: string }[];
}) {
  const project = useCurrentProject();
  const { createChangeOrder } = useCommitmentMutations(project.projectId, commitmentId);
  const [title, setTitle] = useState('');
  const [budgetLineId, setBudgetLineId] = useState(lines[0]?.budgetLineId ?? '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lineOptions = [...new Map(lines.map((l) => [l.budgetLineId, l.description])).entries()].map(
    ([value, label]) => ({ value, label }),
  );

  function save(e: FormEvent) {
    e.preventDefault();
    const amt = parseSignedAmount(amount);
    if (!title.trim()) return setError('Describe the change.');
    if (!budgetLineId) return setError('Choose the budget line.');
    if (!amt) return setError('Enter a dollar amount that is not zero, like 2500 or -800.');
    setError(null);
    createChangeOrder.mutate(
      { title: title.trim(), budgetLineId, amount: amt },
      {
        onSuccess: () => {
          setTitle('');
          setAmount('');
        },
      },
    );
  }
  return (
    <Card title="Raise a change order">
      <form className="stack-lg" noValidate onSubmit={save}>
        <TextField
          label="Change"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="form-row">
          <Select
            label="Budget line"
            placeholder="Choose a budget line"
            required
            options={lineOptions}
            value={budgetLineId}
            onChange={(e) => setBudgetLineId(e.target.value)}
          />
          <TextField
            label="Amount (ex GST, negative to reduce)"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={createChangeOrder.error} title="We couldn't raise this change order" />
        <div className="row-actions">
          <Button type="submit" disabled={createChangeOrder.isPending}>
            Raise change order
          </Button>
        </div>
      </form>
    </Card>
  );
}

function NewPayment({ commitmentId }: { commitmentId: string }) {
  const project = useCurrentProject();
  const { recordPayment } = useCommitmentMutations(project.projectId, commitmentId);
  const today = todayIn(project.timezone);
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    const amt = parseAmount(amount);
    if (!amt || Number(amt) <= 0) return setError('Enter the amount ex GST, above zero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > today)
      return setError('Enter the date it was paid, not in the future.');
    setError(null);
    recordPayment.mutate(
      { amount: amt, paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}) },
      {
        onSuccess: () => {
          setAmount('');
          setReference('');
        },
      },
    );
  }
  return (
    <Card title="Record a payment">
      <form className="stack-lg" noValidate onSubmit={save}>
        <div className="form-row">
          <TextField
            label="Paid on"
            type="date"
            required
            max={today}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
          <TextField
            label="Amount (ex GST)"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label="Reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={recordPayment.error} title="We couldn't record this payment" />
        <div className="row-actions">
          <Button type="submit" disabled={recordPayment.isPending}>
            Record payment
          </Button>
        </div>
      </form>
    </Card>
  );
}
