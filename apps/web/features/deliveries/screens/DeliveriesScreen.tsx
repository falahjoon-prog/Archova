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
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { addDays } from '@archova/time';
import { usePublishAssistantScope } from '@/features/assistant';
import { useCommitments } from '@/features/commitments';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Delivery, Resource, ResourceKind } from '../data/api';
import { BookDeliveryDialog } from '../components/BookDeliveryDialog';
import { DayTimeline } from '../components/DayTimeline';
import { DeliveryDialog } from '../components/DeliveryDialog';
import { NovaBoardPanel } from '../components/NovaBoardPanel';
import {
  useDeliveries,
  useDeliveryInsights,
  useDeliveryMutations,
  useResources,
} from '../hooks/useDeliveries';
import {
  KIND_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  fmtDay,
  fmtWindow,
  layoutDay,
  onDay,
  rangeOf,
} from '../lib/board';

type Panel = 'reschedule' | 'notice' | null;

/**
 * Material deliveries: what is arriving when, at which dock and crane, and what actually turned up. Coordinators
 * book and move deliveries; anyone on site logs the truck arriving. Nova flags late trucks and clashes by rule,
 * finds free slots, drafts notes to suppliers, and answers questions about the board.
 */
export function DeliveriesScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const tz = project.timezone;
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const today = todayIn(tz);
  const [day, setDay] = useState(today);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'deliveries', id: 'board' },
  });
  const level = perms.data?.toolLevels.workforce;
  const canManage =
    perms.data?.orgRole === 'owner' || perms.data?.orgRole === 'admin' || atLeast(level, 'admin');
  const canCheckIn = canManage || atLeast(level, 'standard');

  const first = day < today ? day : today;
  const last = addDays(day > today ? day : today, 14);
  const { from, to } = useMemo(() => rangeOf(first, last, tz), [first, last, tz]);
  const resources = useResources(project.projectId);
  const deliveries = useDeliveries(project.projectId, from, to);
  const insights = useDeliveryInsights(project.projectId);
  const commitments = useCommitments(project.projectId);
  const m = useDeliveryMutations(project.projectId);

  const [booking, setBooking] = useState(false);
  const [open, setOpen] = useState<{ id: string; panel: Panel } | null>(null);

  const purchaseOrders = (commitments.data ?? [])
    .filter((c) => c.kind === 'purchase_order' && c.status === 'approved')
    .map((c) => ({ id: c.id, label: `PO ${c.number} · ${c.title}` }));
  const res = resources.data ?? [];
  const all = deliveries.data ?? [];
  const todays = onDay(all, day, tz);
  const resName = (id: string | null) => res.find((r) => r.id === id)?.name ?? null;
  const flagged = new Set(
    (insights.data?.flags ?? []).filter((f) => f.severity !== 'low').map((f) => f.deliveryId),
  );

  const columns: DataTableColumn<Delivery>[] = [
    {
      id: 'time',
      header: 'Window',
      rowHeader: true,
      sortValue: (d) => d.windowStart,
      cell: (d) => fmtWindow(d, tz),
    },
    {
      id: 'what',
      header: 'Delivery',
      cell: (d) => (
        <>
          <strong>#{d.number}</strong> {d.title}
          <span className="u-caption"> · {d.supplierName}</span>
        </>
      ),
    },
    {
      id: 'where',
      header: 'Dock and crane',
      cell: (d) =>
        [
          resName(d.zoneId) ?? (d.status === 'cancelled' ? '—' : 'No dock yet'),
          resName(d.liftResourceId) ?? (d.needsLift ? 'Crane needed' : null),
        ]
          .filter(Boolean)
          .join(' + '),
    },
    { id: 'po', header: 'Order', cell: (d) => d.commitmentLabel ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (d) => (
        <>
          <StatusPill tone={STATUS_TONES[d.status]}>{STATUS_LABELS[d.status]}</StatusPill>
          {flagged.has(d.id) ? <StatusPill tone="danger">Needs attention</StatusPill> : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (d) => (
        <span className="row-actions">
          {canCheckIn && (d.status === 'scheduled' || d.status === 'delayed') ? (
            <Button
              size="sm"
              disabled={m.checkIn.isPending}
              onClick={() => m.checkIn.mutate({ deliveryId: d.id, event: 'arrived' })}
            >
              Arrived
            </Button>
          ) : null}
          {canCheckIn && d.status === 'arrived' ? (
            <Button
              size="sm"
              disabled={m.checkIn.isPending}
              onClick={() => m.checkIn.mutate({ deliveryId: d.id, event: 'unloaded' })}
            >
              Unloaded
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setOpen({ id: d.id, panel: null })}>
            Open #{d.number}
          </Button>
        </span>
      ),
    },
  ];

  if (resources.isPending || deliveries.isPending || perms.isPending)
    return <SkeletonRows label="Loading deliveries…" />;
  const hasPlaces = res.some((r) => r.active);
  const { unplanned } = layoutDay(all, res, day, tz);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Deliveries"
        description="Material deliveries by day, dock and crane, with check-in at the gate."
        actions={
          canManage ? (
            <Button onClick={() => setBooking(true)} disabled={!hasPlaces}>
              Book a delivery
            </Button>
          ) : undefined
        }
      />
      <ErrorAlert
        error={resources.error ?? deliveries.error}
        title="We couldn't load the deliveries"
      />
      <ErrorAlert error={m.checkIn.error} title="We couldn't log that" />

      <NovaBoardPanel
        insights={insights.data}
        deliveries={all}
        resources={res}
        tz={tz}
        canManage={canManage}
        onOpen={(id, panel) => setOpen({ id, panel })}
      />

      <Card>
        <div className="dlv-daynav">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous day"
            onClick={() => setDay(addDays(day, -1))}
          >
            ‹
          </Button>
          <TextField
            label="Day"
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next day"
            onClick={() => setDay(addDays(day, 1))}
          >
            ›
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            disabled={day === today}
            onClick={() => setDay(today)}
          >
            Today
          </Button>
          <h2 className="u-m-0 dlv-daynav__title">{fmtDay(day)}</h2>
        </div>
        {!hasPlaces ? (
          <EmptyState
            title="Add a dock first"
            description={
              canManage
                ? 'Add the dock, laydown area or crane deliveries will use, below.'
                : 'No docks or cranes have been added yet.'
            }
          />
        ) : (
          <DayTimeline
            deliveries={all}
            resources={res}
            flags={insights.data?.flags ?? []}
            day={day}
            tz={tz}
            onOpen={(id) => setOpen({ id, panel: null })}
          />
        )}
        {unplanned.length > 0 ? (
          <Alert tone="warning">
            {unplanned.length} {unplanned.length === 1 ? 'delivery has' : 'deliveries have'} no dock
            yet and {unplanned.length === 1 ? "isn't" : "aren't"} on the timeline.
          </Alert>
        ) : null}
      </Card>

      <DataTable
        caption={`Deliveries on ${fmtDay(day)}`}
        columns={columns}
        rows={todays}
        getRowId={(d) => d.id}
        empty={
          <EmptyState
            title="Nothing booked for this day"
            description={canManage ? 'Use Book a delivery.' : 'No deliveries are scheduled.'}
          />
        }
      />

      {canManage ? <ResourcesCard resources={res} m={m} /> : null}

      <BookDeliveryDialog
        open={booking}
        onClose={() => setBooking(false)}
        resources={res}
        purchaseOrders={purchaseOrders}
        day={day < today ? today : day}
        tz={tz}
        m={m}
      />
      <DeliveryDialog
        deliveryId={open?.id ?? null}
        initialPanel={open?.panel ?? null}
        onClose={() => setOpen(null)}
        resources={res}
        tz={tz}
        canManage={canManage}
        canCheckIn={canCheckIn}
        senderName={org.user.name}
        m={m}
        projectId={project.projectId}
      />
    </div>
  );
}

const KINDS = Object.entries(KIND_LABELS) as [ResourceKind, string][];

function ResourcesCard({
  resources,
  m,
}: {
  resources: Resource[];
  m: ReturnType<typeof useDeliveryMutations>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ResourceKind>('dock');
  const [capacity, setCapacity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(capacity);
    if (!name.trim()) return setError('Enter a name.');
    if (!Number.isInteger(n) || n < 1 || n > 20)
      return setError('Capacity is a whole number from 1 to 20.');
    m.createResource.mutate(
      { name: name.trim(), kind, capacity: n },
      { onSuccess: () => setName('') },
    );
  }
  return (
    <Card title="Docks, laydown areas and cranes">
      <div className="stack">
        {resources.length > 0 ? (
          <ul className="stack-sm">
            {resources.map((r) => (
              <li key={r.id}>
                {r.name}{' '}
                <span className="u-caption">
                  {KIND_LABELS[r.kind]} · takes {r.capacity} at a time
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <form className="stack" onSubmit={save} noValidate>
          <div className="form-row">
            <TextField
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Select
              label="Kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ResourceKind)}
              options={KINDS.map(([value, label]) => ({ value, label }))}
            />
            <TextField
              label="Takes at once"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              hint="Trucks or lifts at the same time."
            />
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ErrorAlert error={m.createResource.error} title="We couldn't add that" />
          <div className="row-actions">
            <Button type="submit" variant="secondary" loading={m.createResource.isPending}>
              Add
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
