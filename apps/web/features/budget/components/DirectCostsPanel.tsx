'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Select,
  StatusPill,
  Textarea,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { DirectCost } from '../data/api';
import { useBudget, useDirectCostMutations, useDirectCosts } from '../hooks/useBudget';
import { aud, parseAmount } from '../lib/money';

const CATEGORIES = [
  { value: 'labour', label: 'Labour' },
  { value: 'materials', label: 'Materials' },
  { value: 'plant', label: 'Plant' },
  { value: 'fees', label: 'Fees' },
  { value: 'other', label: 'Other' },
] as const;
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);

/**
 * Money spent outside a subcontract or purchase order, posted to a budget line. A recorded cost is never edited: a
 * mistake is voided with a reason, which takes the amount back off the line.
 */
export function DirectCostsPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const q = useDirectCosts(project.projectId);
  const budget = useBudget(project.projectId);
  const { voidCost } = useDirectCostMutations(project.projectId);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const lines = budget.data?.lines ?? [];
  const lineLabel = (id: string) => {
    const l = lines.find((x) => x.id === id);
    return l ? `${l.code} ${l.codeDescription}` : 'Budget line';
  };

  const columns: DataTableColumn<DirectCost>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (c) => c.number,
      cell: (c) => `DC-${String(c.number).padStart(4, '0')}`,
    },
    {
      id: 'date',
      header: 'Date',
      sortValue: (c) => c.incurredOn,
      cell: (c) => formatLocalDate(c.incurredOn),
    },
    {
      id: 'what',
      header: 'Cost',
      cell: (c) => (
        <>
          <span>{c.description}</span>
          <p className="u-m-0 u-caption">
            {[CATEGORY_LABEL[c.category], c.supplier, c.reference].filter(Boolean).join(' · ')}
          </p>
        </>
      ),
    },
    { id: 'line', header: 'Budget line', cell: (c) => lineLabel(c.budgetLineId) },
    {
      id: 'amount',
      header: 'Amount (ex GST)',
      align: 'end',
      sortValue: (c) => Number(c.amount),
      cell: (c) => <span className="u-mono u-nowrap">{aud(c.amount)}</span>,
    },
    {
      id: 'gst',
      header: 'GST',
      align: 'end',
      cell: (c) => <span className="u-mono u-nowrap">{aud(c.gst)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) =>
        c.status === 'void' ? (
          <StatusPill tone="neutral">Voided</StatusPill>
        ) : (
          <StatusPill tone="success">Recorded</StatusPill>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (c) =>
        canManage && c.status === 'recorded' ? (
          <Button size="sm" variant="secondary" onClick={() => setVoiding(c.id)}>
            Void DC-{String(c.number).padStart(4, '0')}
          </Button>
        ) : c.voidReason ? (
          <span className="u-caption">{c.voidReason}</span>
        ) : null,
    },
  ];

  const voidingRow = q.data?.data.find((c) => c.id === voiding);

  return (
    <div className="stack-lg">
      <ErrorAlert error={q.error} title="We couldn't load the direct costs" />
      <DataTable
        caption="Direct costs"
        columns={columns}
        rows={q.data?.data ?? []}
        getRowId={(c) => c.id}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No direct costs"
            description="Record money spent outside a subcontract or purchase order against a budget line."
          />
        }
      />
      {q.data ? (
        <p className="u-m-0">
          Recorded direct costs total <span className="u-mono">{aud(q.data.total)}</span> ex GST.
        </p>
      ) : null}
      <ErrorAlert error={voidCost.error} title="We couldn't void that cost" />
      {voidingRow ? (
        <Card title={`Void DC-${String(voidingRow.number).padStart(4, '0')}`}>
          <form
            className="stack-lg"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!note.trim()) return setNoteError('Give the reason for voiding this cost.');
              setNoteError(null);
              voidCost.mutate(
                { directCostId: voidingRow.id, note: note.trim() },
                {
                  onSuccess: () => {
                    setVoiding(null);
                    setNote('');
                  },
                },
              );
            }}
          >
            <Textarea
              label="Reason for voiding"
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteError ? <Alert tone="danger">{noteError}</Alert> : null}
            <div className="row-actions">
              <Button type="submit" disabled={voidCost.isPending}>
                Confirm void
              </Button>
              <Button variant="secondary" onClick={() => setVoiding(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {canManage ? <RecordDirectCostForm /> : null}
    </div>
  );
}

function RecordDirectCostForm() {
  const project = useCurrentProject();
  const budget = useBudget(project.projectId);
  const { record } = useDirectCostMutations(project.projectId);
  const [budgetLineId, setBudgetLineId] = useState('');
  const [category, setCategory] = useState('materials');
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const today = todayIn(project.timezone);
  const [incurredOn, setIncurredOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [gst, setGst] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = parseAmount(amount);
    const gstAmt = gst.trim() ? parseAmount(gst) : '0.00';
    if (!budgetLineId) return setError('Choose the budget line this cost belongs to.');
    if (!description.trim()) return setError('Describe what was bought.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)) return setError('Enter the date it was incurred.');
    if (incurredOn > today) return setError('A cost cannot be incurred in the future.');
    if (!amt || Number(amt) <= 0)
      return setError('Enter the amount ex GST, above zero, like 1200.50.');
    if (gstAmt === null) return setError('Enter the GST as a dollar amount, or leave it blank.');
    record.mutate(
      {
        budgetLineId,
        category: category as (typeof CATEGORIES)[number]['value'],
        description: description.trim(),
        ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        incurredOn,
        amount: amt,
        gst: gstAmt,
      },
      {
        onSuccess: () => {
          setDescription('');
          setSupplier('');
          setReference('');
          setAmount('');
          setGst('');
        },
      },
    );
  }

  return (
    <Card title="Record a direct cost">
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <Select
            label="Budget line"
            placeholder="Choose a budget line"
            required
            options={(budget.data?.lines ?? []).map((l) => ({
              value: l.id,
              label: `${l.code} ${l.codeDescription}`,
            }))}
            value={budgetLineId}
            onChange={(e) => setBudgetLineId(e.target.value)}
          />
          <Select
            label="Category"
            options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <TextField
          label="Description"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="form-row">
          <TextField
            label="Supplier"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
          <TextField
            label="Invoice or reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Date incurred"
            type="date"
            required
            max={today}
            value={incurredOn}
            onChange={(e) => setIncurredOn(e.target.value)}
          />
          <TextField
            label="Amount (ex GST)"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label="GST"
            inputMode="decimal"
            value={gst}
            onChange={(e) => setGst(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={record.error} title="We couldn't record this cost" />
        <div className="row-actions">
          <Button type="submit" disabled={record.isPending}>
            {record.isPending ? 'Saving…' : 'Record direct cost'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
