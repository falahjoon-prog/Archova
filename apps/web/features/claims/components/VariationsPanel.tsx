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
import { useCostCodes } from '@/features/budget';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Variation, VariationAction } from '../data/api';
import { useClaimsMutations, useVariations } from '../hooks/useClaims';
import { VARIATION_LABELS } from '../lib/deadline';
import { aud, cents } from '../lib/money';

const TONE = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
} as const;

/**
 * Variations to one contract (CLM-US8). Only an approved variation can be claimed, so the status is always shown, and
 * a rejection needs a reason that is recorded with the decision.
 */
export function VariationsPanel({
  contractId,
  canManage,
  canDecide,
}: {
  contractId: string;
  canManage: boolean;
  canDecide: boolean;
}) {
  const project = useCurrentProject();
  const q = useVariations(project.projectId, contractId);
  const { moveVariation, setVariationCostCode } = useClaimsMutations(project.projectId);
  // Only people who can see cost codes get the picker; for everyone else the column is left out.
  const costCodes = (useCostCodes(project.projectId).data ?? []).filter((c) => !c.archived);
  const codeOf = (id: string | null) => costCodes.find((c) => c.id === id);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const act = (v: Variation, action: VariationAction, text?: string) =>
    moveVariation.mutate(
      { variationId: v.id, action, ...(text ? { note: text } : {}) },
      {
        onSuccess: () => {
          setRejecting(null);
          setNote('');
        },
      },
    );

  const columns: DataTableColumn<Variation>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (v) => v.number,
      cell: (v) => `Variation ${v.number}`,
    },
    { id: 'title', header: 'Title', cell: (v) => v.title },
    {
      id: 'amount',
      header: 'Amount (ex GST)',
      align: 'end',
      cell: (v) => <span className="u-mono">{aud(v.amount)}</span>,
    },
    {
      id: 'claimed',
      header: 'Claimed so far',
      align: 'end',
      cell: (v) => <span className="u-mono">{aud(v.claimedToDate)}</span>,
    },
    ...(costCodes.length > 0
      ? [
          {
            id: 'costCode',
            header: 'Cost code',
            cell: (v: Variation) =>
              canManage && v.status !== 'rejected' && v.status !== 'withdrawn' ? (
                <select
                  className="ac-input ac-select"
                  aria-label={`Cost code for variation ${v.number}`}
                  value={v.costCodeId ?? ''}
                  onChange={(e) =>
                    setVariationCostCode.mutate({
                      variationId: v.id,
                      costCodeId: e.target.value || null,
                    })
                  }
                >
                  <option value="">Not coded</option>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} {c.description}
                    </option>
                  ))}
                </select>
              ) : (
                (() => {
                  const c = codeOf(v.costCodeId);
                  return c ? `${c.code} ${c.description}` : 'Not coded';
                })()
              ),
          } satisfies DataTableColumn<Variation>,
        ]
      : []),
    { id: 'days', header: 'Time', align: 'end', cell: (v) => `${v.timeImpactDays} days` },
    {
      id: 'status',
      header: 'Status',
      cell: (v) => <StatusPill tone={TONE[v.status]}>{VARIATION_LABELS[v.status]}</StatusPill>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (v) => (
        <span className="row-actions">
          {canManage && v.status === 'draft' ? (
            <Button size="sm" onClick={() => act(v, 'submit')}>
              Submit variation {v.number}
            </Button>
          ) : null}
          {canDecide && v.status === 'submitted' ? (
            <>
              <Button size="sm" onClick={() => act(v, 'approve')}>
                Approve variation {v.number}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(v.id)}>
                Reject variation {v.number}
              </Button>
            </>
          ) : null}
          {canManage && (v.status === 'draft' || v.status === 'submitted') ? (
            <Button size="sm" variant="secondary" onClick={() => act(v, 'withdraw')}>
              Withdraw variation {v.number}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const rejectingRow = q.data?.data.find((v) => v.id === rejecting);

  return (
    <div className="stack-lg">
      <ErrorAlert error={q.error} title="We couldn't load the variations" />
      <DataTable
        caption="Variations"
        columns={columns}
        rows={q.data?.data ?? []}
        getRowId={(v) => v.id}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No variations"
            description="A variation can be claimed once it has been approved."
          />
        }
      />
      {q.data ? (
        <p className="u-m-0">
          Approved variations total <span className="u-mono">{aud(q.data.approvedTotal)}</span> ex
          GST.
        </p>
      ) : null}
      <ErrorAlert error={moveVariation.error} title="We couldn't update that variation" />
      <ErrorAlert error={setVariationCostCode.error} title="We couldn't code that variation" />
      {rejectingRow ? (
        <Card title={`Reject variation ${rejectingRow.number}`}>
          <form
            className="stack-lg"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!note.trim())
                return setNoteError('Give the reason for rejecting this variation.');
              setNoteError(null);
              act(rejectingRow, 'reject', note.trim());
            }}
          >
            <Textarea
              label="Reason for rejecting"
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteError ? <Alert tone="danger">{noteError}</Alert> : null}
            <div className="row-actions">
              <Button type="submit" disabled={moveVariation.isPending}>
                Confirm rejection
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {canManage ? <NewVariationForm contractId={contractId} /> : null}
    </div>
  );
}

function NewVariationForm({ contractId }: { contractId: string }) {
  const project = useCurrentProject();
  const { createVariation } = useClaimsMutations(project.projectId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('0');
  const [costCodeId, setCostCodeId] = useState('');
  const costCodes = (useCostCodes(project.projectId).data ?? []).filter((c) => !c.archived);
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const c = cents(amount);
    if (!title.trim()) return setError('Give the variation a title.');
    if (c === null || c <= 0) return setError('Enter the amount as a dollar amount above zero.');
    if (!/^\d{1,4}$/.test(days.trim())) return setError('Enter the time impact in whole days.');
    createVariation.mutate(
      {
        contractId,
        body: {
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          amount: amount.trim(),
          timeImpactDays: Number(days),
          ...(costCodeId ? { costCodeId } : {}),
        },
      },
      {
        onSuccess: () => {
          setTitle('');
          setDescription('');
          setAmount('');
          setDays('0');
          setCostCodeId('');
        },
      },
    );
  }

  return (
    <Card title="Draft a variation">
      <form className="stack-lg" onSubmit={save} noValidate>
        <TextField
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="form-row">
          <TextField
            label="Amount (ex GST)"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label="Time impact (days)"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        {costCodes.length > 0 ? (
          <Select
            label="Cost code"
            placeholder="Not coded"
            options={costCodes.map((c) => ({ value: c.id, label: `${c.code} ${c.description}` }))}
            value={costCodeId}
            onChange={(e) => setCostCodeId(e.target.value)}
          />
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={createVariation.error} title="We couldn't save this variation" />
        <div className="row-actions">
          <Button type="submit" disabled={createVariation.isPending}>
            {createVariation.isPending ? 'Saving…' : 'Save draft variation'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
