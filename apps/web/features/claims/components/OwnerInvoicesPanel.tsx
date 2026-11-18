'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { OwnerInvoice, OwnerInvoiceBackupItem, OwnerInvoiceCandidate } from '../data/api';
import {
  useOwnerInvoice,
  useOwnerInvoiceMutations,
  useOwnerInvoicePrefill,
  useOwnerInvoices,
} from '../hooks/useClaims';
import { aud, cents } from '../lib/money';

const BACKUP_LABELS: Record<OwnerInvoiceBackupItem['kind'], string> = {
  claim_pdf: 'Sealed claim',
  payment_schedule_pdf: 'Payment schedule',
  subcontractor_statement: "Subcontractor's statement",
};

/** "Sealed claim, payment schedule missing" style summary of what backs a claim up. */
export function backupSummary(items: OwnerInvoiceBackupItem[]): string {
  const missing = items.filter((b) => b.status === 'missing').map((b) => BACKUP_LABELS[b.kind]);
  return missing.length ? `Backup missing: ${missing.join(', ')}` : 'Backup complete';
}

/** Markup on a sub total, to the cent, for the live total in the dialog. */
export function totalWithMarkup(amounts: string[], markupPct: string): string | null {
  const pct = Number(markupPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  const sub = amounts.reduce((s, a) => s + (cents(a) ?? 0), 0);
  const total = sub + Math.round((sub * Math.round(pct * 100)) / 10_000);
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`;
}

/**
 * Owner invoices on the head contract: pre-fill a draft from the approved subcontractor claims, with Nova's
 * duplicate and outlier check before anything is compiled, and the backup pack that goes with it. Drafts only; the
 * owner claim itself is still recorded on the claim form.
 */
export function OwnerInvoicesPanel({
  contractId,
  canManage,
}: {
  contractId: string;
  canManage: boolean;
}) {
  const project = useCurrentProject();
  const list = useOwnerInvoices(project.projectId, contractId);
  const m = useOwnerInvoiceMutations(project.projectId, contractId);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const detail = useOwnerInvoice(project.projectId, viewing);

  const columns: DataTableColumn<OwnerInvoice>[] = [
    {
      id: 'number',
      header: 'Draft',
      rowHeader: true,
      sortValue: (x) => x.number,
      cell: (x) => `Owner invoice ${x.number}`,
    },
    { id: 'period', header: 'Period ends', cell: (x) => formatLocalDate(x.periodEnd) },
    {
      id: 'sub',
      header: 'Subcontract cost',
      align: 'end',
      cell: (x) => <span className="u-mono">{aud(x.subTotal)}</span>,
    },
    {
      id: 'markup',
      header: 'Markup',
      align: 'end',
      cell: (x) => <span className="u-mono">{aud(x.markupAmount)}</span>,
    },
    {
      id: 'total',
      header: 'Total (ex GST)',
      align: 'end',
      cell: (x) => <span className="u-mono">{aud(x.total)}</span>,
    },
    {
      id: 'actions',
      header: <span className="u-visually-hidden">Actions</span>,
      align: 'end',
      cell: (x) => (
        <span className="row-actions">
          <Button variant="secondary" onClick={() => setViewing(viewing === x.id ? null : x.id)}>
            {viewing === x.id ? 'Hide backup' : 'View backup'}
          </Button>
          {canManage ? (
            <Button
              variant="secondary"
              disabled={m.discard.isPending}
              onClick={() =>
                m.discard.mutate(x.id, { onSuccess: () => viewing === x.id && setViewing(null) })
              }
            >
              Discard
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="row-end">
        <h2 className="u-m-0">Owner invoices</h2>
        {canManage ? <Button onClick={() => setOpen(true)}>Pre-fill owner invoice</Button> : null}
      </div>
      <ErrorAlert error={list.error} title="We couldn't load the owner invoices" />
      <ErrorAlert error={m.discard.error} title="We couldn't discard that draft" />
      <DataTable
        caption="Owner invoice drafts"
        columns={columns}
        rows={list.data ?? []}
        getRowId={(x) => x.id}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No owner invoice drafts"
            description="Pre-fill one from the approved subcontractor claims and their backup."
          />
        }
      />
      {viewing ? (
        <Card title="Backup pack">
          {detail.isError ? (
            <ErrorAlert error={detail.error} title="We couldn't open the draft" />
          ) : null}
          {detail.data ? (
            <ul className="stack u-m-0">
              {detail.data.lines.map((l) => (
                <li key={l.claimId}>
                  <strong>
                    {l.contractTitle}, claim {l.number}
                  </strong>{' '}
                  <span className="u-mono">{aud(l.amount)}</span>
                  <br />
                  <span className="u-muted">
                    {l.backup
                      .map(
                        (b) =>
                          `${BACKUP_LABELS[b.kind]}: ${
                            b.status === 'attached'
                              ? 'attached'
                              : b.status === 'missing'
                                ? 'missing'
                                : 'not required'
                          }`,
                      )
                      .join(' · ')}
                  </span>
                  {l.flags.length ? (
                    <>
                      <br />
                      <span className="u-caption">
                        Flagged and confirmed: {l.flags.map((f) => f.message).join(' ')}
                      </span>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {detail.data && detail.data.missingBackup > 0 ? (
            <Alert tone="warning">
              {detail.data.missingBackup} backup item{detail.data.missingBackup === 1 ? '' : 's'}{' '}
              still missing. Record the subcontractor's statement or issue the schedule to complete
              the pack.
            </Alert>
          ) : null}
        </Card>
      ) : null}
      {open ? (
        <PrefillDialog
          contractId={contractId}
          onClose={() => setOpen(false)}
          onCreated={(id) => {
            setOpen(false);
            setViewing(id);
          }}
        />
      ) : null}
    </div>
  );
}

function PrefillDialog({
  contractId,
  onClose,
  onCreated,
}: {
  contractId: string;
  onClose: () => void;
  onCreated: (invoiceId: string) => void;
}) {
  const project = useCurrentProject();
  const [periodEnd, setPeriodEnd] = useState(() => todayIn(project.timezone));
  const [markupPct, setMarkupPct] = useState('0');
  const [note, setNote] = useState('');
  // Picks are kept per claim; a claim Nova flagged starts unticked and needs its own confirmation.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const prefill = useOwnerInvoicePrefill(
    project.projectId,
    contractId,
    periodEnd,
    periodEnd !== '',
  );
  const { create } = useOwnerInvoiceMutations(project.projectId, contractId);
  const candidates: OwnerInvoiceCandidate[] = prefill.data?.candidates ?? [];
  const isPicked = (c: OwnerInvoiceCandidate) => picked[c.claimId] ?? c.flags.length === 0;
  const chosen = candidates.filter(isPicked);
  const blocked = chosen.filter((c) => c.flags.length > 0 && !confirmed[c.claimId]);
  const total = useMemo(
    () =>
      totalWithMarkup(
        chosen.map((c) => c.amount),
        markupPct,
      ),
    [chosen, markupPct],
  );
  const flaggedCount = candidates.filter((c) => c.flags.length > 0).length;
  const ready = chosen.length > 0 && blocked.length === 0 && total !== null && periodEnd !== '';

  return (
    <Dialog
      open
      onClose={onClose}
      title="Do you want to pre-fill the owner invoice?"
      description="Approved subcontractor claims are compiled with their backup. Nova checks them first; you confirm anything it flags."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  periodEnd,
                  markupPct: markupPct.trim() || '0',
                  ...(note.trim() ? { note: note.trim() } : {}),
                  claimIds: chosen.map((c) => c.claimId),
                  confirmedClaimIds: chosen
                    .filter((c) => confirmed[c.claimId])
                    .map((c) => c.claimId),
                },
                { onSuccess: (d) => onCreated(d.invoice.id) },
              )
            }
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-row">
          <TextField
            label="Period ends"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
          <TextField
            label="Markup (%)"
            inputMode="decimal"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
            error={total === null ? 'Enter a percentage from 0 to 100' : undefined}
          />
        </div>
        <ErrorAlert error={prefill.error} title="We couldn't load the subcontractor claims" />
        {prefill.isPending ? <p className="u-muted">Checking the subcontractor claims…</p> : null}
        {prefill.data && candidates.length === 0 ? (
          <EmptyState
            title="Nothing to compile"
            description="No approved subcontractor claims up to this date are waiting. Issue a payment schedule on a claim to approve it."
          />
        ) : null}
        {flaggedCount > 0 ? (
          <Alert tone="warning" title="Nova flagged some claims">
            {flaggedCount} claim{flaggedCount === 1 ? '' : 's'} look off. They are left out until
            you tick them and confirm you have checked.
          </Alert>
        ) : null}
        <ul className="stack u-m-0">
          {candidates.map((c) => (
            <li key={c.claimId}>
              <Checkbox
                checked={isPicked(c)}
                onChange={(e) => setPicked({ ...picked, [c.claimId]: e.target.checked })}
                label={
                  <>
                    {c.contractTitle}, claim {c.number}, to {formatLocalDate(c.periodEnd)}{' '}
                    <span className="u-mono">{aud(c.amount)}</span>{' '}
                    {c.flags.length ? <StatusPill tone="warning">Flagged</StatusPill> : null}
                  </>
                }
                hint={backupSummary(c.backup)}
              />
              {c.flags.length && isPicked(c) ? (
                <div className="stack">
                  <ul className="u-m-0">
                    {c.flags.map((f) => (
                      <li key={f.code}>{f.message}</li>
                    ))}
                  </ul>
                  <Checkbox
                    checked={confirmed[c.claimId] ?? false}
                    onChange={(e) => setConfirmed({ ...confirmed, [c.claimId]: e.target.checked })}
                    label="I've checked this and it belongs on the owner invoice"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <TextField
          label="Note (optional)"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
        {chosen.length ? (
          <p className="u-m-0">
            {chosen.length} claim{chosen.length === 1 ? '' : 's'}
            {total ? (
              <>
                , total with markup <span className="u-mono">{aud(total)}</span> ex GST
              </>
            ) : null}
          </p>
        ) : null}
        <ErrorAlert error={create.error} title="We couldn't create the draft" />
      </div>
    </Dialog>
  );
}
