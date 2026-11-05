'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CostForecast, ForecastAdjustment } from '../data/api';
import { useCostForecast, useForecastMutations } from '../hooks/useClaims';
import { aud } from '../lib/money';

type Commitment = CostForecast['commitments'][number];

export const ADJUSTMENT_LABELS: Record<ForecastAdjustment['category'], string> = {
  unawarded_work: 'Unawarded work',
  allowance: 'Allowance',
  risk: 'Risk',
  saving: 'Saving',
  other: 'Other',
};

const SIGNED = /^-?\d{1,16}(\.\d{1,2})?$/;

/**
 * Projected cost to complete, final cost and margin for the project (product/09). It is built from contracts,
 * approved variations and claims; staff add what is not yet in them (unawarded work, allowances, risks, savings).
 * Margin is builder-only, so the screen is for admins of the payment claims tool.
 */
export function CostForecastScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'cost-forecast', id: 'forecast' },
  });
  const allowed =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.payment_claims, 'admin');
  const q = useCostForecast(project.projectId, allowed);

  const header = (
    <PageHeader
      title="Cost forecast"
      description="What the project is forecast to cost at completion, from contracts, approved variations and claims, plus your adjustments. All amounts are ex GST."
      actions={
        <Link className="link" href={webRoutes.contracts(org.orgSlug, project.projectId)}>
          <Button type="button" variant="secondary">
            Contracts
          </Button>
        </Link>
      }
    />
  );

  if (perms.isPending) return <SkeletonRows label="Loading the cost forecast…" />;
  if (!allowed)
    return (
      <div className="stack-lg">
        {header}
        <Alert tone="warning">
          The cost forecast shows the project margin, so only project administrators can see it.
        </Alert>
      </div>
    );
  return (
    <div className="stack-lg">
      {header}
      <ErrorAlert error={q.error} title="We couldn't load the cost forecast" />
      {q.isPending ? <SkeletonRows label="Loading the cost forecast…" /> : null}
      {q.data ? <ForecastBody f={q.data} projectId={project.projectId} /> : null}
    </div>
  );
}

function ForecastBody({ f, projectId }: { f: CostForecast; projectId: string }) {
  const org = useCurrentOrg();
  const loss = f.forecastMargin.startsWith('-');
  const columns: DataTableColumn<Commitment>[] = [
    {
      id: 'title',
      header: 'Subcontract',
      rowHeader: true,
      sortValue: (c) => c.number,
      cell: (c) => (
        <Link className="link" href={webRoutes.contract(org.orgSlug, projectId, c.contractId)}>
          C-{String(c.number).padStart(3, '0')} {c.title}
        </Link>
      ),
    },
    money('committed', 'Committed', (c) => c.committed),
    money('claimed', 'Claimed to date', (c) => c.claimedToDate),
    money('toComplete', 'Cost to complete', (c) => c.costToComplete),
    money('adjustments', 'Adjustments', (c) => c.adjustments),
    money('final', 'Forecast final', (c) => c.forecastFinal),
    money('pending', 'Variations pending', (c) => c.pendingVariations),
  ];
  return (
    <>
      {loss ? (
        <Alert tone="danger">
          This project is forecast to finish at a loss of {aud(f.forecastMargin.slice(1))}.
        </Alert>
      ) : null}
      <div className="forecast-summary">
        <Card title="Cost">
          <DescriptionList
            items={[
              { label: 'Committed', value: aud(f.committed), mono: true },
              { label: 'Claimed to date', value: aud(f.claimedToDate), mono: true },
              { label: 'Cost to complete', value: aud(f.costToComplete), mono: true },
              { label: 'Adjustments', value: aud(f.projectAdjustments), mono: true },
              { label: 'Forecast final cost', value: aud(f.forecastFinalCost), mono: true },
            ]}
          />
        </Card>
        <Card title="Revenue and margin">
          <DescriptionList
            items={[
              { label: 'Contract revenue', value: aud(f.revenue), mono: true },
              { label: 'Billed to date', value: aud(f.billedToDate), mono: true },
              { label: 'Forecast margin', value: aud(f.forecastMargin), mono: true },
              {
                label: 'Margin',
                value: f.forecastMarginPct === null ? '—' : `${f.forecastMarginPct}%`,
                mono: true,
              },
            ]}
          />
        </Card>
      </div>
      {Number(f.pendingCostVariations) > 0 || Number(f.pendingRevenueVariations) > 0 ? (
        <Alert tone="info">
          Submitted variations are not in the forecast until they are approved:{' '}
          {aud(f.pendingCostVariations)} on subcontracts and {aud(f.pendingRevenueVariations)} on
          the head contract.
        </Alert>
      ) : null}
      <DataTable
        caption="Forecast by subcontract"
        columns={columns}
        rows={f.commitments}
        getRowId={(c) => c.contractId}
        defaultSort={{ columnId: 'title', direction: 'asc' }}
        empty={
          <EmptyState
            title="No subcontracts yet"
            description="Set up subcontracts and the forecast builds itself from them and their claims."
          />
        }
      />
      <Adjustments f={f} projectId={projectId} />
    </>
  );
}

function money(
  id: string,
  header: string,
  get: (c: Commitment) => string,
): DataTableColumn<Commitment> {
  return {
    id,
    header,
    align: 'end',
    sortValue: (c) => Number(get(c)),
    cell: (c) => <span className="u-mono">{aud(get(c))}</span>,
  };
}

function Adjustments({ f, projectId }: { f: CostForecast; projectId: string }) {
  const { createAdjustment, deleteAdjustment } = useForecastMutations(projectId);
  const [category, setCategory] = useState<ForecastAdjustment['category']>('unawarded_work');
  const [contractId, setContractId] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const subName = (id: string | null) => {
    const c = f.commitments.find((x) => x.contractId === id);
    return c ? `C-${String(c.number).padStart(3, '0')} ${c.title}` : 'Whole project';
  };

  const columns: DataTableColumn<ForecastAdjustment>[] = [
    { id: 'label', header: 'Adjustment', rowHeader: true, cell: (a) => a.label },
    { id: 'category', header: 'Type', cell: (a) => ADJUSTMENT_LABELS[a.category] },
    { id: 'applies', header: 'Applies to', cell: (a) => subName(a.contractId) },
    {
      id: 'amount',
      header: 'Amount (ex GST)',
      align: 'end',
      cell: (a) => <span className="u-mono">{aud(a.amount)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (a) => (
        <Button
          size="sm"
          variant="secondary"
          disabled={deleteAdjustment.isPending}
          onClick={() => deleteAdjustment.mutate(a.id)}
        >
          Remove {a.label}
        </Button>
      ),
    },
  ];

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const a = amount.trim();
    if (!label.trim()) return setError('Say what this adjustment is for.');
    if (!SIGNED.test(a) || Number(a) === 0)
      return setError('Enter the amount as a dollar amount, not zero. Use a minus for a saving.');
    createAdjustment.mutate(
      {
        category,
        label: label.trim(),
        amount: a,
        ...(contractId ? { contractId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          setLabel('');
          setNote('');
          setAmount('');
        },
      },
    );
  }

  return (
    <div className="stack-lg">
      <h2 className="u-m-0">Adjustments</h2>
      <ErrorAlert error={deleteAdjustment.error} title="We couldn't remove that adjustment" />
      <DataTable
        caption="Forecast adjustments"
        columns={columns}
        rows={f.adjustments}
        getRowId={(a) => a.id}
        empty={
          <EmptyState
            title="No adjustments"
            description="Add work you have not awarded yet, an allowance, a risk or an expected saving."
          />
        }
      />
      <Card title="Add an adjustment">
        <form className="stack-lg" onSubmit={save} noValidate>
          <div className="form-row">
            <Select
              label="Type"
              value={category}
              onChange={(e) => setCategory(e.target.value as ForecastAdjustment['category'])}
              options={Object.entries(ADJUSTMENT_LABELS).map(([value, l]) => ({ value, label: l }))}
            />
            <Select
              label="Applies to"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              options={[
                { value: '', label: 'Whole project' },
                ...f.commitments.map((c) => ({
                  value: c.contractId,
                  label: subName(c.contractId),
                })),
              ]}
            />
          </div>
          <TextField
            label="What is it for"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <TextField
            label="Amount (ex GST)"
            hint="Use a minus for a saving."
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ErrorAlert error={createAdjustment.error} title="We couldn't save this adjustment" />
          <div className="row-actions">
            <Button type="submit" disabled={createAdjustment.isPending}>
              {createAdjustment.isPending ? 'Saving…' : 'Add adjustment'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
