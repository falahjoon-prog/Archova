'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { RetentionRelease } from '../data/api';
import { useRetentionMutations, useRetentionRelease } from '../hooks/useClaims';
import { RELEASE_STAGE_LABELS, RELEASE_STATUS_LABELS } from '../lib/deadline';
import { aud, cents } from '../lib/money';

type Stage = RetentionRelease['stages'][number];
type Status = Stage['status'];

const TONE: Record<Status, StatusTone> = {
  awaiting_date: 'neutral',
  upcoming: 'info',
  due: 'warning',
  released: 'success',
};

/** When retention comes back to the payee: the contract's two release stages, what is released, what is left. */
export function RetentionReleasePanel({
  contractId,
  canManage,
}: {
  contractId: string;
  canManage: boolean;
}) {
  const project = useCurrentProject();
  const q = useRetentionRelease(project.projectId, contractId);
  if (q.isPending) return <SkeletonRows label="Loading retention release…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't load retention release" />;
  const r = q.data;
  const stageColumns: DataTableColumn<Stage>[] = [
    {
      id: 'stage',
      header: 'Stage',
      rowHeader: true,
      cell: (s) => RELEASE_STAGE_LABELS[s.stage],
    },
    { id: 'due', header: 'Due', cell: (s) => (s.dueOn ? formatLocalDate(s.dueOn) : '—') },
    {
      id: 'entitled',
      header: 'Entitled',
      align: 'end',
      cell: (s) => <span className="u-mono">{aud(s.entitled)}</span>,
    },
    {
      id: 'released',
      header: 'Released',
      align: 'end',
      cell: (s) => <span className="u-mono">{aud(s.released)}</span>,
    },
    {
      id: 'remaining',
      header: 'Remaining',
      align: 'end',
      cell: (s) => <span className="u-mono">{aud(s.remaining)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <StatusPill tone={TONE[s.status]}>{RELEASE_STATUS_LABELS[s.status]}</StatusPill>,
    },
  ];
  const releaseColumns: DataTableColumn<RetentionRelease['releases'][number]>[] = [
    { id: 'date', header: 'Date', cell: (x) => formatLocalDate(x.releasedOn) },
    { id: 'stage', header: 'Stage', cell: (x) => RELEASE_STAGE_LABELS[x.stage] },
    { id: 'ref', header: 'Reference', rowHeader: true, cell: (x) => x.reference },
    {
      id: 'amount',
      header: 'Amount',
      align: 'end',
      cell: (x) => <span className="u-mono">{aud(x.amount)}</span>,
    },
  ];
  return (
    <section className="stack-lg" aria-label="Retention release">
      <Card title="Retention release">
        <DescriptionList
          items={[
            { label: 'Retention held', value: aud(r.retentionHeld), mono: true },
            { label: 'Released at practical completion', value: `${r.terms.firstReleasePct}%` },
            {
              label: 'Practical completion',
              value: r.terms.practicalCompletionOn
                ? formatLocalDate(r.terms.practicalCompletionOn)
                : 'Not set',
            },
            {
              label: 'Defects period',
              value:
                r.terms.defectsPeriodDays === null
                  ? 'Not set'
                  : `${r.terms.defectsPeriodDays} days`,
            },
          ]}
        />
      </Card>
      <DataTable
        caption="Release stages"
        columns={stageColumns}
        rows={r.stages}
        getRowId={(s) => s.stage}
      />
      <DataTable
        caption="Retention released"
        columns={releaseColumns}
        rows={r.releases}
        getRowId={(x) => `${x.stage}-${x.recordedAt}`}
        empty={<p className="u-m-0">No retention has been released yet.</p>}
      />
      {canManage ? (
        <>
          <Card title="Release terms">
            <TermsForm contractId={contractId} r={r} />
          </Card>
          <Card title="Record a release">
            <ReleaseForm contractId={contractId} r={r} />
          </Card>
        </>
      ) : null}
    </section>
  );
}

function TermsForm({ contractId, r }: { contractId: string; r: RetentionRelease }) {
  const project = useCurrentProject();
  const { saveTerms } = useRetentionMutations(project.projectId, contractId);
  const [pcOn, setPcOn] = useState(r.terms.practicalCompletionOn ?? '');
  const [days, setDays] = useState(
    r.terms.defectsPeriodDays === null ? '' : String(r.terms.defectsPeriodDays),
  );
  const [pct, setPct] = useState(r.terms.firstReleasePct);
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = days.trim() === '' ? null : Number(days);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 3650))
      return setError('Enter the defects period as a whole number of days.');
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(pct) || Number(pct) > 100)
      return setError(
        'Enter the share released at practical completion as a percentage, 0 to 100.',
      );
    saveTerms.mutate({
      practicalCompletionOn: pcOn || null,
      defectsPeriodDays: n,
      firstReleasePct: pct,
    });
  }
  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      <TextField
        label="Practical completion date"
        type="date"
        value={pcOn}
        onChange={(e) => setPcOn(e.target.value)}
      />
      <TextField
        label="Defects period (days)"
        inputMode="numeric"
        value={days}
        onChange={(e) => setDays(e.target.value)}
      />
      <TextField
        label="Share released at practical completion (%)"
        inputMode="decimal"
        value={pct}
        hint="The rest is released when the defects period ends."
        onChange={(e) => setPct(e.target.value)}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={saveTerms.error} title="We couldn't save the release terms" />
      <div className="row-actions">
        <Button type="submit" disabled={saveTerms.isPending}>
          {saveTerms.isPending ? 'Saving…' : 'Save release terms'}
        </Button>
      </div>
    </form>
  );
}

function ReleaseForm({ contractId, r }: { contractId: string; r: RetentionRelease }) {
  const project = useCurrentProject();
  const { recordRelease } = useRetentionMutations(project.projectId, contractId);
  const [stage, setStage] = useState<Stage['stage']>('practical_completion');
  const [amount, setAmount] = useState('');
  const [releasedOn, setReleasedOn] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = r.stages.find((s) => s.stage === stage);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (current?.status === 'awaiting_date')
      return setError('Set the practical completion date and defects period first.');
    const c = cents(amount);
    if (c === null || c === 0)
      return setError('Enter the amount as a dollar amount, like 5000.00.');
    if (current && c > (cents(current.remaining) ?? 0))
      return setError(
        `That is more than the ${aud(current.remaining)} still to release for this stage.`,
      );
    if (!releasedOn) return setError('Enter the date the retention was released.');
    if (!reference.trim()) return setError('Enter a reference, like the payment number.');
    recordRelease.mutate(
      { stage, amount: amount.trim(), releasedOn, reference: reference.trim() },
      {
        onSuccess: () => {
          setAmount('');
          setReference('');
        },
      },
    );
  }
  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      <Select
        label="Stage"
        value={stage}
        options={Object.entries(RELEASE_STAGE_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(e) => setStage(e.target.value as Stage['stage'])}
      />
      <TextField
        label="Amount"
        inputMode="decimal"
        value={amount}
        hint={current ? `${aud(current.remaining)} still to release for this stage.` : undefined}
        onChange={(e) => setAmount(e.target.value)}
      />
      <TextField
        label="Date released"
        type="date"
        value={releasedOn}
        onChange={(e) => setReleasedOn(e.target.value)}
      />
      <TextField
        label="Reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={recordRelease.error} title="We couldn't record this release" />
      <div className="row-actions">
        <Button type="submit" disabled={recordRelease.isPending}>
          {recordRelease.isPending ? 'Recording…' : 'Record release'}
        </Button>
      </div>
    </form>
  );
}
