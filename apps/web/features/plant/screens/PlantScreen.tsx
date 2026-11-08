'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Tabs,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { addDays } from '@archova/time';
import { useQuery } from '@tanstack/react-query';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { queries } from '@/shared/lib/api';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type {
  PlantAllocation,
  PlantAsset,
  PlantAssetCategory,
  PlantAssetStatus,
  PlantFlag,
  PlantPlan,
} from '../data/api';
import { usePlantData, usePlantMutations, usePlantUtilisation } from '../hooks/usePlant';

const ZONE = 'Australia/Sydney';
const WINDOW_DAYS = 30;
const CATEGORIES: Record<PlantAssetCategory, string> = {
  crane: 'Crane',
  excavator: 'Excavator',
  loader: 'Loader',
  truck: 'Truck',
  generator: 'Generator',
  access_platform: 'Access platform',
  compaction: 'Compaction',
  lighting: 'Lighting',
  other: 'Other',
};
const STATUS: Record<PlantAssetStatus, string> = {
  active: 'In service',
  maintenance: 'In the workshop',
  retired: 'Retired',
};
const KIND = {
  service: 'Service',
  inspection: 'Inspection',
  certification: 'Certificate',
} as const;
const DUE = {
  ok: { tone: 'success', text: 'On track' },
  due_soon: { tone: 'warning', text: 'Due soon' },
  overdue: { tone: 'danger', text: 'Overdue' },
} as const;
const SEVERITY = { critical: 'danger', warning: 'warning', info: 'info' } as const;

const money = (cents: number | null) =>
  cents === null
    ? '—'
    : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
const dollarsToCents = (v: string) => Math.round(Number(v) * 100);

type Mutations = ReturnType<typeof usePlantMutations>;

/**
 * The organisation's plant: every crane, excavator and generator, owned or hired, where each is allocated, when it is
 * next serviced or certified, and how hard it is working. Nova's flags (rule-based) lead the page.
 */
export function PlantScreen() {
  const org = useCurrentOrg();
  const today = todayIn(ZONE);
  const to = addDays(today, WINDOW_DAYS);
  const past = addDays(today, -WINDOW_DAYS);
  const [tab, setTab] = useState('overview');
  const { assets, allocations, plans, flags } = usePlantData(today, to);
  const util = usePlantUtilisation(past, today);
  const projects = useQuery(queries.projects(org.orgId));
  const m = usePlantMutations();
  const canManage = org.role === 'owner' || org.role === 'admin';

  const assetName = useMemo(() => {
    const map = new Map((assets.data ?? []).map((a) => [a.id, `${a.name} (${a.assetNumber})`]));
    return (id: string) => map.get(id) ?? 'Machine';
  }, [assets.data]);
  const projectName = (id: string) =>
    projects.data?.data.find((p) => p.id === id)?.name ?? 'Project';

  if (assets.isPending) return <SkeletonRows label="Loading plant…" />;
  const fleet = assets.data ?? [];
  const list = flags.data ?? [];
  const critical = list.filter((f) => f.severity === 'critical').length;

  const machines: DataTableColumn<PlantAsset>[] = [
    { id: 'name', header: 'Machine', rowHeader: true, cell: (a) => a.name },
    { id: 'no', header: 'Asset no.', cell: (a) => <span className="u-mono">{a.assetNumber}</span> },
    { id: 'cat', header: 'Type', cell: (a) => CATEGORIES[a.category] },
    {
      id: 'own',
      header: 'Owned or hired',
      cell: (a) =>
        a.ownership === 'hired' ? `Hired${a.supplier ? ` from ${a.supplier}` : ''}` : 'Owned',
    },
    { id: 'rate', header: 'Daily rate', cell: (a) => money(a.dailyRateCents) },
    {
      id: 'status',
      header: 'Status',
      cell: (a) =>
        canManage ? (
          <select
            className="ac-input ac-select"
            style={{ minWidth: '9rem' }}
            aria-label={`Status of ${a.name}`}
            value={a.status}
            onChange={(e) =>
              m.setStatus.mutate({ assetId: a.id, status: e.target.value as PlantAssetStatus })
            }
          >
            {Object.entries(STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <StatusPill tone={a.status === 'active' ? 'success' : 'neutral'}>
            {STATUS[a.status]}
          </StatusPill>
        ),
    },
  ];

  const booked: DataTableColumn<PlantAllocation>[] = [
    { id: 'machine', header: 'Machine', rowHeader: true, cell: (a) => assetName(a.assetId) },
    { id: 'project', header: 'Project', cell: (a) => projectName(a.projectId) },
    {
      id: 'dates',
      header: 'Dates',
      sortValue: (a) => a.startsOn,
      cell: (a) => `${formatLocalDate(a.startsOn)} to ${formatLocalDate(a.endsOn)}`,
    },
    { id: 'cost', header: 'Est. cost', cell: (a) => money(a.estimatedCostCents) },
    {
      id: 'status',
      header: 'Status',
      cell: (a) => (
        <StatusPill tone={a.status === 'active' ? 'success' : 'neutral'}>
          {a.status === 'active' ? 'Allocated' : 'Cancelled'}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (a) =>
        a.status === 'active' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={m.cancelAllocation.isPending}
            onClick={() => m.cancelAllocation.mutate(a.id)}
          >
            Cancel allocation of {assetName(a.assetId)}
          </Button>
        ) : null,
    },
  ];

  const schedule: DataTableColumn<PlantPlan>[] = [
    { id: 'machine', header: 'Machine', rowHeader: true, cell: (p) => assetName(p.assetId) },
    { id: 'title', header: 'Job', cell: (p) => `${p.title} (${KIND[p.kind]})` },
    {
      id: 'due',
      header: 'Next due',
      sortValue: (p) => p.nextDueOn ?? '9999-12-31',
      cell: (p) => (p.nextDueOn ? formatLocalDate(p.nextDueOn) : 'Done'),
    },
    {
      id: 'every',
      header: 'Repeats',
      cell: (p) => (p.intervalDays ? `Every ${p.intervalDays} days` : 'Once'),
    },
    {
      id: 'state',
      header: 'State',
      cell: (p) =>
        p.state ? <StatusPill tone={DUE[p.state].tone}>{DUE[p.state].text}</StatusPill> : null,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (p: PlantPlan) =>
              p.active ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={m.completePlan.isPending}
                  onClick={() => m.completePlan.mutate({ planId: p.id, body: { doneOn: today } })}
                >
                  Mark {p.title} of {assetName(p.assetId)} done today
                </Button>
              ) : null,
          } satisfies DataTableColumn<PlantPlan>,
        ]
      : []),
  ];

  const u = util.data;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Plant and equipment"
        description="Cranes, excavators, generators and the rest of the fleet: where each is, when it is serviced, and how hard it works."
      />
      <ErrorAlert error={assets.error} title="We couldn't load the fleet" />
      <ErrorAlert
        error={m.setStatus.error ?? m.cancelAllocation.error ?? m.completePlan.error}
        title="We couldn't update that"
      />
      <Tabs
        label="Plant sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview', count: list.length },
          { id: 'fleet', label: 'Fleet', count: fleet.length },
          { id: 'schedule', label: 'Allocations' },
          { id: 'maintenance', label: 'Maintenance' },
          { id: 'utilisation', label: 'Utilisation' },
        ]}
      >
        {tab === 'overview' ? (
          <div className="stack-lg">
            <StatGrid
              items={[
                { label: 'Machines', value: fleet.filter((a) => a.status !== 'retired').length },
                {
                  label: 'Needs attention',
                  value: critical,
                  tone: critical > 0 ? 'danger' : 'success',
                },
                {
                  label: `Fleet in use, last ${WINDOW_DAYS} days`,
                  value: u ? `${u.fleetPct}%` : '…',
                },
              ]}
            />
            <Card title="Nova flags">
              <ErrorAlert error={flags.error} title="We couldn't load the flags" />
              {list.length === 0 ? (
                <EmptyState
                  title="Nothing to flag"
                  description="Maintenance is on track, nothing is booked twice and no machine is sitting idle."
                />
              ) : (
                <ul className="stack-sm" aria-label="Fleet flags">
                  {list.map((f, i) => (
                    <FlagRow key={`${f.code}-${f.subjectId ?? f.assetId}-${i}`} flag={f} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        ) : null}
        {tab === 'fleet' ? (
          <div className="stack-lg">
            <DataTable
              caption="Fleet register"
              columns={machines}
              rows={fleet}
              getRowId={(a) => a.id}
              empty={
                <EmptyState
                  title="No machines yet"
                  description={canManage ? 'Add one below.' : 'Nothing has been registered.'}
                />
              }
            />
            {canManage ? <AssetForm m={m} /> : null}
          </div>
        ) : null}
        {tab === 'schedule' ? (
          <div className="stack-lg">
            <ErrorAlert error={allocations.error} title="We couldn't load allocations" />
            <DataTable
              caption={`Allocations, next ${WINDOW_DAYS} days`}
              columns={booked}
              rows={allocations.data ?? []}
              getRowId={(a) => a.id}
              empty={
                <EmptyState
                  title="No allocations"
                  description="Nothing is allocated in this window."
                />
              }
            />
            <AllocateForm
              machines={fleet}
              projects={(projects.data?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
              today={today}
              m={m}
            />
          </div>
        ) : null}
        {tab === 'maintenance' ? (
          <div className="stack-lg">
            <ErrorAlert error={plans.error} title="We couldn't load the schedule" />
            <DataTable
              caption="Maintenance, inspections and certificates"
              columns={schedule}
              rows={plans.data ?? []}
              getRowId={(p) => p.id}
              empty={
                <EmptyState
                  title="Nothing scheduled"
                  description="Add a service or certificate below."
                />
              }
            />
            {canManage ? <PlanForm machines={fleet} today={today} m={m} /> : null}
          </div>
        ) : null}
        {tab === 'utilisation' ? (
          <div className="stack-lg">
            <ErrorAlert error={util.error} title="We couldn't load utilisation" />
            {u ? (
              <>
                <StatGrid
                  items={[
                    { label: 'Fleet in use', value: `${u.fleetPct}%`, hint: `Last ${u.days} days` },
                    {
                      label: 'Idle cost',
                      value: money(
                        u.assets.every((a) => a.idleCostCents === null)
                          ? null
                          : u.assets.reduce((s, a) => s + (a.idleCostCents ?? 0), 0),
                      ),
                      hint: 'Daily rate times idle days',
                    },
                  ]}
                />
                <DataTable
                  caption="Utilisation by machine"
                  columns={[
                    {
                      id: 'machine',
                      header: 'Machine',
                      rowHeader: true,
                      cell: (r) => assetName(r.assetId),
                    },
                    { id: 'booked', header: 'Days in use', cell: (r) => r.bookedDays },
                    { id: 'idle', header: 'Days idle', cell: (r) => r.idleDays },
                    {
                      id: 'pct',
                      header: 'In use',
                      sortValue: (r) => r.pct,
                      cell: (r) => `${r.pct}%`,
                    },
                    { id: 'cost', header: 'Cost of use', cell: (r) => money(r.costCents) },
                    { id: 'idlecost', header: 'Cost of idle', cell: (r) => money(r.idleCostCents) },
                  ]}
                  rows={u.assets}
                  getRowId={(r) => r.assetId}
                  empty={
                    <EmptyState
                      title="No machines"
                      description="Add machines to see utilisation."
                    />
                  }
                />
                <DataTable
                  caption="Plant by project"
                  columns={[
                    {
                      id: 'project',
                      header: 'Project',
                      rowHeader: true,
                      cell: (r) => projectName(r.projectId),
                    },
                    { id: 'days', header: 'Machine days', cell: (r) => r.bookedDays },
                    { id: 'cost', header: 'Plant cost', cell: (r) => money(r.costCents) },
                  ]}
                  rows={u.projects}
                  getRowId={(r) => r.projectId}
                  empty={
                    <EmptyState
                      title="No allocations"
                      description="Nothing was allocated in this period."
                    />
                  }
                />
              </>
            ) : (
              <SkeletonRows label="Loading utilisation…" />
            )}
          </div>
        ) : null}
      </Tabs>
    </div>
  );
}

function FlagRow({ flag }: { flag: PlantFlag }) {
  return (
    <li>
      <Alert tone={SEVERITY[flag.severity]}>{flag.message}</Alert>
    </li>
  );
}

function AssetForm({ m }: { m: Mutations }) {
  const [name, setName] = useState('');
  const [assetNumber, setAssetNumber] = useState('');
  const [category, setCategory] = useState<PlantAssetCategory>('excavator');
  const [ownership, setOwnership] = useState<'owned' | 'hired'>('owned');
  const [supplier, setSupplier] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !assetNumber.trim())
      return setError('Give the machine a name and an asset number.');
    if (rate && !(Number(rate) >= 0)) return setError('The daily rate must be a dollar amount.');
    m.createAsset.mutate(
      {
        name: name.trim(),
        assetNumber: assetNumber.trim(),
        category,
        ownership,
        ...(ownership === 'hired' && supplier.trim() ? { supplier: supplier.trim() } : {}),
        ...(rate ? { dailyRateCents: dollarsToCents(rate) } : {}),
      },
      {
        onSuccess: () => {
          setName('');
          setAssetNumber('');
          setSupplier('');
          setRate('');
        },
      },
    );
  }
  return (
    <Card title="Add a machine">
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Asset number"
            required
            value={assetNumber}
            onChange={(e) => setAssetNumber(e.target.value)}
          />
        </div>
        <div className="form-row">
          <Select
            label="Type"
            value={category}
            onChange={(e) => setCategory(e.target.value as PlantAssetCategory)}
            options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Owned or hired"
            value={ownership}
            onChange={(e) => setOwnership(e.target.value as 'owned' | 'hired')}
            options={[
              { value: 'owned', label: 'Owned' },
              { value: 'hired', label: 'Hired' },
            ]}
          />
        </div>
        <div className="form-row">
          {ownership === 'hired' ? (
            <TextField
              label="Hire company"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          ) : null}
          <TextField
            label="Daily rate ($)"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.createAsset.error} title="We couldn't add this machine" />
        <div className="row-actions">
          <Button type="submit" disabled={m.createAsset.isPending}>
            {m.createAsset.isPending ? 'Saving…' : 'Add machine'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AllocateForm({
  machines,
  projects,
  today,
  m,
}: {
  machines: PlantAsset[];
  projects: { id: string; name: string }[];
  today: string;
  m: Mutations;
}) {
  const [assetId, setAssetId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assetId) return setError('Choose the machine.');
    if (!projectId) return setError('Choose the project.');
    if (endsOn < startsOn) return setError('The allocation must not end before it starts.');
    m.allocate.mutate({ assetId, body: { projectId, startsOn, endsOn } });
  }
  return (
    <Card title="Allocate a machine to a project">
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <Select
            label="Machine"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            options={[
              { value: '', label: 'Choose a machine' },
              ...machines
                .filter((a) => a.status === 'active')
                .map((a) => ({ value: a.id, label: `${a.name} (${a.assetNumber})` })),
            ]}
          />
          <Select
            label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            options={[
              { value: '', label: 'Choose a project' },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <div className="form-row">
          <TextField
            label="From"
            type="date"
            required
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
          <TextField
            label="To"
            type="date"
            required
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.allocate.error} title="We couldn't allocate this machine" />
        <div className="row-actions">
          <Button type="submit" disabled={m.allocate.isPending}>
            {m.allocate.isPending ? 'Saving…' : 'Allocate machine'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PlanForm({ machines, today, m }: { machines: PlantAsset[]; today: string; m: Mutations }) {
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'service' | 'inspection' | 'certification'>('service');
  const [nextDueOn, setNextDueOn] = useState(addDays(today, 30));
  const [interval, setInterval] = useState('');
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assetId) return setError('Choose the machine.');
    if (!title.trim()) return setError('Say what the job is, for example "500 hour service".');
    if (interval && !(Number.isInteger(Number(interval)) && Number(interval) > 0))
      return setError('The repeat interval must be a whole number of days.');
    m.createPlan.mutate(
      {
        assetId,
        body: {
          title: title.trim(),
          kind,
          nextDueOn,
          ...(interval ? { intervalDays: Number(interval) } : {}),
        },
      },
      { onSuccess: () => setTitle('') },
    );
  }
  return (
    <Card title="Schedule a service, inspection or certificate">
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <Select
            label="Machine"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            options={[
              { value: '', label: 'Choose a machine' },
              ...machines.map((a) => ({ value: a.id, label: `${a.name} (${a.assetNumber})` })),
            ]}
          />
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            options={Object.entries(KIND).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <TextField label="Job" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="form-row">
          <TextField
            label="Next due"
            type="date"
            required
            value={nextDueOn}
            onChange={(e) => setNextDueOn(e.target.value)}
          />
          <TextField
            label="Repeats every (days)"
            inputMode="numeric"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.createPlan.error} title="We couldn't schedule this" />
        <div className="row-actions">
          <Button type="submit" disabled={m.createPlan.isPending}>
            {m.createPlan.isPending ? 'Saving…' : 'Schedule'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
