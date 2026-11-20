'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Tabs,
  TextField,
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { addDays } from '@archova/time';
import { useQuery } from '@tanstack/react-query';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { queries } from '@/shared/lib/api';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useFeatureFlag } from '@/shared/hooks/useFeatureFlag';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { ConditionPhotos } from '../components/ConditionPhotos';
import type {
  PlantAllocation,
  PlantAsset,
  PlantAssetCategory,
  PlantAssetStatus,
  PlantContractorNotice,
  PlantFlag,
  PlantPlan,
} from '../data/api';
import {
  useCostCodes,
  usePlantData,
  usePlantMutations,
  usePlantUtilisation,
} from '../hooks/usePlant';

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
  const { assets, allocations, plans, flags, notices } = usePlantData(today, to);
  const util = usePlantUtilisation(past, today);
  const projects = useQuery(queries.projects(org.orgId));
  const m = usePlantMutations();
  // Staff keep the register and allocate machines; daily rates are for owners and admins (plant.rates.view).
  const canManage = org.role === 'owner' || org.role === 'admin' || org.role === 'member';
  const canSeeRates = org.role === 'owner' || org.role === 'admin';

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
    ...(canSeeRates
      ? [
          {
            id: 'rate',
            header: 'Daily rate',
            cell: (a: PlantAsset) => money(a.dailyRateCents),
          } satisfies DataTableColumn<PlantAsset>,
        ]
      : []),
    {
      id: 'contractor',
      header: 'Contractor',
      cell: (a) => <ContractorCell asset={a} canManage={canManage} m={m} />,
    },
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
    ...(canSeeRates
      ? [
          {
            id: 'cost',
            header: 'Est. cost',
            cell: (a: PlantAllocation) => money(a.estimatedCostCents),
          } satisfies DataTableColumn<PlantAllocation>,
        ]
      : []),
    {
      id: 'posted',
      header: 'Posted to budget',
      cell: (a) =>
        a.postedThrough
          ? `Through ${formatLocalDate(a.postedThrough)}`
          : a.costCodeId
            ? 'Not yet'
            : 'No cost code',
    },
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
          { id: 'condition', label: 'Condition photos' },
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
                    <FlagRow
                      key={`${f.code}-${f.subjectId ?? f.assetId}-${i}`}
                      flag={f}
                      asset={fleet.find((a) => a.id === f.assetId)}
                      notices={notices.data ?? []}
                      canManage={canManage}
                      m={m}
                    />
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
            {canManage ? <AssetForm m={m} canSeeRates={canSeeRates} /> : null}
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
        {tab === 'condition' ? <ConditionPhotos machines={fleet} canManage={canManage} /> : null}
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

const NOTIFIABLE = new Set([
  'maintenance_overdue',
  'maintenance_due_soon',
  'certification_expired',
  'certification_expiring',
]);

type Channel = 'email' | 'sms' | 'phone';
const CHANNEL_NAME: Record<Channel, string> = {
  email: 'email',
  sms: 'text from Archova',
  phone: 'text from your phone',
};

function FlagRow({
  flag,
  asset,
  notices,
  canManage,
  m,
}: {
  flag: PlantFlag;
  asset: PlantAsset | undefined;
  notices: PlantContractorNotice[];
  canManage: boolean;
  m: Mutations;
}) {
  const archovaTexts = useFeatureFlag('plant.sms');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<Channel[]>(['email']);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const notifiable = canManage && NOTIFIABLE.has(flag.code) && flag.subjectId && asset;
  const sent = notices.filter((n) => n.planId === flag.subjectId);
  const channels: { id: Channel; label: string; hint: string; available: boolean }[] = asset
    ? [
        {
          id: 'email',
          label: 'Email',
          hint: asset.contractorEmail ?? 'Add a contractor email on the Fleet tab',
          available: !!asset.contractorEmail,
        },
        {
          id: 'phone',
          label: 'Text from my phone',
          hint: asset.contractorPhone
            ? `Opens your phone's messages to ${asset.contractorPhone}; you press send`
            : 'Add a contractor phone number on the Fleet tab',
          available: !!asset.contractorPhone,
        },
        ...(archovaTexts
          ? [
              {
                id: 'sms' as const,
                label: 'Text from Archova',
                hint: asset.contractorPhone ?? 'Add a contractor phone number on the Fleet tab',
                available: !!asset.contractorPhone,
              },
            ]
          : []),
      ]
    : [];
  const toggle = (c: Channel) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!asset || !flag.subjectId) return;
    const chosen = picked.filter((c) => channels.find((x) => x.id === c)?.available);
    if (chosen.length === 0) return setError(new Error('Choose how to notify them.'));
    setBusy(true);
    setError(null);
    try {
      for (const channel of chosen) {
        const n = await m.notifyContractor.mutateAsync({
          assetId: asset.id,
          planId: flag.subjectId,
          message: message.trim(),
          channel,
        });
        // Their own phone sends it: hand the ready-made text to the messages app.
        if (channel === 'phone' && n.recipientPhone)
          window.location.href = `sms:${n.recipientPhone}?&body=${encodeURIComponent(n.text)}`;
      }
      setOpen(false);
      setMessage('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="stack-sm">
      <Alert tone={SEVERITY[flag.severity]}>{flag.message}</Alert>
      {sent.map((n) => (
        <p className="u-muted" role="status" key={n.id}>
          Contractor notified by {CHANNEL_NAME[n.channel]}{' '}
          {formatLocalDate(n.createdAt.slice(0, 10))}
          {n.status === 'failed' ? ', but it could not be delivered' : ''}.
        </p>
      ))}
      {notifiable ? (
        open ? (
          <form className="stack-sm" onSubmit={send}>
            <p className="u-muted">
              Tells {asset.contractorName ?? 'the contractor'} the machine, the job and the due
              date. They don&apos;t need an Archova account.
            </p>
            {channels.map((c) => (
              <Checkbox
                key={c.id}
                label={c.label}
                hint={c.hint}
                disabled={!c.available}
                checked={picked.includes(c.id) && c.available}
                onChange={() => toggle(c.id)}
              />
            ))}
            <Textarea
              label="Note (optional)"
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
            />
            <ErrorAlert error={error} title="We couldn't notify the contractor" />
            <div className="row-actions">
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send to contractor'}
              </Button>
              <Button type="button" variant="tertiary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : channels.some((c) => c.available) ? (
          <div className="row-actions">
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              Notify contractor
            </Button>
          </div>
        ) : (
          <p className="u-muted">
            Add a contractor email or phone number to {asset.name} on the Fleet tab to notify them
            from here.
          </p>
        )
      ) : null}
    </li>
  );
}

function ContractorCell({
  asset,
  canManage,
  m,
}: {
  asset: PlantAsset;
  canManage: boolean;
  m: Mutations;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.contractorName ?? '');
  const [email, setEmail] = useState(asset.contractorEmail ?? '');
  const [phone, setPhone] = useState(asset.contractorPhone ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!editing)
    return (
      <div className="stack-sm">
        <span>
          {asset.contractorEmail || asset.contractorPhone
            ? [asset.contractorName, asset.contractorEmail, asset.contractorPhone]
                .filter(Boolean)
                .join(', ')
            : '—'}
        </span>
        {canManage ? (
          <Button type="button" variant="tertiary" onClick={() => setEditing(true)}>
            {asset.contractorEmail || asset.contractorPhone ? 'Edit contractor' : 'Add contractor'}
            <span className="u-visually-hidden"> for {asset.name}</span>
          </Button>
        ) : null}
      </div>
    );
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError('Enter a valid email address.');
    m.setContractor.mutate(
      {
        assetId: asset.id,
        contractorName: name.trim(),
        contractorEmail: email.trim(),
        contractorPhone: phone.trim(),
      },
      { onSuccess: () => setEditing(false) },
    );
  }
  return (
    <form className="stack-sm" onSubmit={save} noValidate>
      <TextField label="Contractor name" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="Contractor email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Contractor mobile"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={m.setContractor.error} title="We couldn't save the contractor" />
      <div className="row-actions">
        <Button type="submit" disabled={m.setContractor.isPending}>
          {m.setContractor.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="tertiary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AssetForm({ m, canSeeRates }: { m: Mutations; canSeeRates: boolean }) {
  const [name, setName] = useState('');
  const [assetNumber, setAssetNumber] = useState('');
  const [category, setCategory] = useState<PlantAssetCategory>('excavator');
  const [ownership, setOwnership] = useState<'owned' | 'hired'>('owned');
  const [supplier, setSupplier] = useState('');
  const [rate, setRate] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [contractorEmail, setContractorEmail] = useState('');
  const [contractorPhone, setContractorPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (contractorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contractorEmail.trim()))
      return setError('Enter a valid contractor email address.');
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
        ...(canSeeRates && rate ? { dailyRateCents: dollarsToCents(rate) } : {}),
        ...(contractorName.trim() ? { contractorName: contractorName.trim() } : {}),
        ...(contractorEmail.trim() ? { contractorEmail: contractorEmail.trim() } : {}),
        ...(contractorPhone.trim() ? { contractorPhone: contractorPhone.trim() } : {}),
      },
      {
        onSuccess: () => {
          setName('');
          setAssetNumber('');
          setSupplier('');
          setRate('');
          setContractorName('');
          setContractorEmail('');
          setContractorPhone('');
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
          {canSeeRates ? (
            <TextField
              label="Daily rate ($)"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          ) : null}
        </div>
        <div className="form-row">
          <TextField
            label="Contractor name (optional)"
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
          />
          <TextField
            label="Contractor email (optional)"
            type="email"
            value={contractorEmail}
            onChange={(e) => setContractorEmail(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Contractor mobile (optional)"
            type="tel"
            value={contractorPhone}
            onChange={(e) => setContractorPhone(e.target.value)}
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
  const [costCodeId, setCostCodeId] = useState('');
  const codes = useCostCodes(projectId);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assetId) return setError('Choose the machine.');
    if (!projectId) return setError('Choose the project.');
    if (endsOn < startsOn) return setError('The allocation must not end before it starts.');
    m.allocate.mutate({
      assetId,
      body: { projectId, startsOn, endsOn, ...(costCodeId ? { costCodeId } : {}) },
    });
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
            onChange={(e) => {
              setProjectId(e.target.value);
              setCostCodeId('');
            }}
            options={[
              { value: '', label: 'Choose a project' },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <Select
          label="Cost code (hire cost is posted to this budget line)"
          value={costCodeId}
          onChange={(e) => setCostCodeId(e.target.value)}
          options={[
            {
              value: '',
              label: projectId
                ? (codes.data ?? []).length
                  ? 'No cost code, not posted to the budget'
                  : 'No cost codes you can use on this project'
                : 'Choose a project first',
            },
            ...(codes.data ?? [])
              .filter((c) => !c.archived)
              .map((c) => ({ value: c.id, label: `${c.code} ${c.description}` })),
          ]}
        />
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
