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
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { LaborProductivityRow } from '../data/api';
import { useLaborProductivity, useSetProduction } from '../hooks/useBudget';

const num = (n: number | null, digits = 2) =>
  n === null ? '–' : n.toLocaleString('en-AU', { maximumFractionDigits: digits });
const pct = (n: number | null) => (n === null ? '–' : `${(n * 100).toFixed(1)}%`);
const rate = (n: number | null, uom: string | null) =>
  n === null ? '–' : `${num(n)}${uom ? ` ${uom}/hr` : ''}`;

/**
 * Labor productivity: timesheet hours against the production plan for each cost code. Earned hours are percent
 * complete times budgeted hours; a row is flagged when the crew's actual rate is below the budgeted rate.
 */
export function LaborProductivityPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const [divisionId, setDivisionId] = useState('');
  const [subJobId, setSubJobId] = useState('');
  const filter = {
    ...(divisionId ? { divisionId } : {}),
    ...(subJobId ? { subJobId } : {}),
  };
  const q = useLaborProductivity(project.projectId, filter);
  const [editing, setEditing] = useState<{
    costCodeId: string;
    row: LaborProductivityRow | null;
  } | null>(null);

  const codes = q.data?.codes ?? [];
  const divisions = codes.filter((c) => c.parentId === null);
  // Sub-jobs: any code that has children, optionally narrowed to the chosen division.
  const parents = new Set(codes.map((c) => c.parentId).filter((id): id is string => id !== null));
  const byId = new Map(codes.map((c) => [c.id, c]));
  const inDivision = (id: string): boolean => {
    if (!divisionId) return true;
    let cur: string | null = id;
    for (let i = 0; cur && i < 20; i++) {
      if (cur === divisionId) return true;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  };
  const subJobs = codes.filter((c) => parents.has(c.id) && inDivision(c.id));

  const columns: DataTableColumn<LaborProductivityRow>[] = [
    {
      id: 'code',
      header: 'Cost code',
      rowHeader: true,
      sortValue: (r) => r.code,
      cell: (r) => (
        <>
          <span>{r.code}</span>
          <p className="u-m-0 u-caption">{r.description}</p>
        </>
      ),
    },
    {
      id: 'hours',
      header: 'Timesheet hours',
      align: 'end',
      sortValue: (r) => r.timesheetHours,
      cell: (r) => <span className="u-mono u-nowrap">{num(r.timesheetHours)}</span>,
    },
    {
      id: 'used',
      header: '% hours used',
      align: 'end',
      sortValue: (r) => r.pctHoursUsed ?? -1,
      cell: (r) => <span className="u-mono u-nowrap">{pct(r.pctHoursUsed)}</span>,
    },
    {
      id: 'earned',
      header: 'Earned hours',
      align: 'end',
      sortValue: (r) => r.earnedHours ?? -1,
      cell: (r) => <span className="u-mono u-nowrap">{num(r.earnedHours)}</span>,
    },
    {
      id: 'complete',
      header: '% complete production',
      align: 'end',
      sortValue: (r) => r.pctComplete ?? -1,
      cell: (r) => <span className="u-mono u-nowrap">{pct(r.pctComplete)}</span>,
    },
    { id: 'uom', header: 'UOM', cell: (r) => r.uom ?? '–' },
    {
      id: 'budgeted',
      header: 'Revised budgeted rate',
      align: 'end',
      sortValue: (r) => r.budgetedRate ?? -1,
      cell: (r) => <span className="u-mono u-nowrap">{rate(r.budgetedRate, r.uom)}</span>,
    },
    {
      id: 'actual',
      header: 'Actual rate',
      align: 'end',
      sortValue: (r) => r.actualRate ?? -1,
      cell: (r) => (
        <span className="u-mono u-nowrap">
          {rate(r.actualRate, r.uom)}{' '}
          {r.flagged ? <StatusPill tone="danger">Below plan</StatusPill> : null}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'end' as const,
            cell: (r: LaborProductivityRow) => (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing({ costCodeId: r.costCodeId, row: r })}
              >
                Edit plan {r.code}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const t = q.data?.totals;
  return (
    <div className="stack-lg">
      <ErrorAlert error={q.error} title="We couldn't load labor productivity" />
      <div className="form-row">
        <Select
          label="Division"
          placeholder="All divisions"
          options={divisions.map((c) => ({ value: c.id, label: `${c.code} ${c.description}` }))}
          value={divisionId}
          onChange={(e) => {
            setDivisionId(e.target.value);
            setSubJobId('');
          }}
        />
        <Select
          label="Sub-job"
          placeholder="All sub-jobs"
          options={subJobs.map((c) => ({ value: c.id, label: `${c.code} ${c.description}` }))}
          value={subJobId}
          onChange={(e) => setSubJobId(e.target.value)}
        />
      </div>
      <DataTable
        caption="Labor productivity by cost code"
        columns={columns}
        rows={q.data?.rows ?? []}
        getRowId={(r) => r.costCodeId}
        defaultSort={{ columnId: 'code', direction: 'asc' }}
        rowClassName={(r) => (r.flagged ? 'row--flagged' : undefined)}
        empty={
          <EmptyState
            title="No labor productivity yet"
            description="Set a production plan (budgeted hours and quantity) for a cost code, and book timesheet hours against it."
          />
        }
      />
      {t ? (
        <p className="u-m-0">
          <span className="u-mono">{num(t.timesheetHours)}</span> timesheet hours against{' '}
          <span className="u-mono">{num(t.budgetedHours)}</span> budgeted ({pct(t.pctHoursUsed)}{' '}
          used), <span className="u-mono">{num(t.earnedHours)}</span> earned. {t.flaggedRows} below
          plan.
          {q.data && q.data.unallocatedHours > 0
            ? ` ${num(q.data.unallocatedHours)} hours have no cost code.`
            : ''}
        </p>
      ) : null}
      <p className="u-m-0 u-caption">
        Hours come from submitted, approved and exported timesheets, with breaks taken off.
      </p>
      {canManage ? (
        editing ? (
          <PlanForm
            key={editing.costCodeId}
            initial={editing}
            onDone={() => setEditing(null)}
            codes={codes}
          />
        ) : (
          <div className="row-actions">
            <Button variant="secondary" onClick={() => setEditing({ costCodeId: '', row: null })}>
              Set a production plan
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function PlanForm({
  initial,
  codes,
  onDone,
}: {
  initial: { costCodeId: string; row: LaborProductivityRow | null };
  codes: { id: string; code: string; description: string }[];
  onDone: () => void;
}) {
  const project = useCurrentProject();
  const save = useSetProduction(project.projectId);
  const r = initial.row;
  const [costCodeId, setCostCodeId] = useState(initial.costCodeId);
  const [uom, setUom] = useState(r?.uom ?? '');
  const [hours, setHours] = useState(r?.budgetedHours?.toString() ?? '');
  const [qty, setQty] = useState(r?.budgetedQuantity?.toString() ?? '');
  const [done, setDone] = useState(r?.quantityComplete?.toString() ?? '0');
  const [error, setError] = useState<string | null>(null);
  const parse = (v: string) => (/^\d{1,10}(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const bh = parse(hours);
    const bq = parse(qty);
    const qd = parse(done);
    if (!costCodeId) return setError('Choose the cost code.');
    if (!uom.trim()) return setError('Enter the unit of measure, like m2 or lm.');
    if (bh === null) return setError('Enter the budgeted hours as a number, like 120.');
    if (bq === null) return setError('Enter the budgeted quantity as a number, like 500.');
    if (qd === null) return setError('Enter the quantity in place to date, or 0.');
    save.mutate(
      {
        costCodeId,
        body: { uom: uom.trim(), budgetedHours: bh, budgetedQuantity: bq, quantityComplete: qd },
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Card title="Production plan">
      <form className="stack-lg" onSubmit={submit} noValidate>
        <div className="form-row">
          <Select
            label="Cost code"
            placeholder="Choose a cost code"
            required
            disabled={r !== null}
            options={codes.map((c) => ({ value: c.id, label: `${c.code} ${c.description}` }))}
            value={costCodeId}
            onChange={(e) => setCostCodeId(e.target.value)}
          />
          <TextField
            label="Unit of measure"
            required
            value={uom}
            onChange={(e) => setUom(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Budgeted hours"
            inputMode="decimal"
            required
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <TextField
            label="Budgeted quantity"
            inputMode="decimal"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <TextField
            label="Quantity in place to date"
            inputMode="decimal"
            value={done}
            onChange={(e) => setDone(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={save.error} title="We couldn't save the plan" />
        <div className="row-actions">
          <Button type="submit" disabled={save.isPending}>
            Save plan
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
