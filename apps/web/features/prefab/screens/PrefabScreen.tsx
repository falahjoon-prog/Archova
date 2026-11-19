'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { addDays } from '@archova/time';
import { usePublishAssistantScope } from '@/features/assistant';
import { useDeliveries } from '@/features/deliveries';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { AddUnitDialog } from '../components/AddUnitDialog';
import { NovaPrefabPanel } from '../components/NovaPrefabPanel';
import { UnitDialog } from '../components/UnitDialog';
import type { Unit } from '../data/api';
import { usePrefabInsights, usePrefabMutations, usePrefabUnits } from '../hooks/usePrefab';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES, fmtDate } from '../lib/units';

/**
 * Prefabricated and modular construction: every pod, panel and module built off site, from the factory floor to the
 * crane hook. People move units along and record QA; Nova flags what is late, held or out of sequence by rule.
 */
export function PrefabScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'prefab', id: 'board' },
  });
  const level = perms.data?.toolLevels.schedule;
  const canWrite =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(level, 'standard');

  const units = usePrefabUnits(project.projectId);
  const insights = usePrefabInsights(project.projectId);
  const m = usePrefabMutations(project.projectId);
  const today = todayIn(project.timezone);
  const range = useMemo(
    () => ({
      from: new Date(`${addDays(today, -7)}T00:00:00Z`).toISOString(),
      to: new Date(`${addDays(today, 90)}T00:00:00Z`).toISOString(),
    }),
    [today],
  );
  const deliveries = useDeliveries(project.projectId, range.from, range.to);
  const deliveryOptions = (deliveries.data ?? [])
    .filter((d) => d.status !== 'cancelled')
    .map((d) => ({
      id: d.id,
      label: `#${d.number} · ${d.title} · ${formatInstant(d.windowStart, project.timezone)}`,
    }));

  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (units.isPending || perms.isPending) return <SkeletonRows label="Loading prefab units…" />;
  const all = units.data ?? [];
  const flagged = new Set(
    (insights.data?.flags ?? []).filter((f) => f.severity !== 'low').map((f) => f.unitId),
  );
  const s = insights.data?.summary;

  const columns: DataTableColumn<Unit>[] = [
    {
      id: 'unit',
      header: 'Unit',
      rowHeader: true,
      sortValue: (u) => u.installSequence ?? Number.MAX_SAFE_INTEGER,
      cell: (u) => {
        // The kind is only worth saying when the name does not already say it ("Level 3 bathroom pod").
        const kind = KIND_LABELS[u.kind];
        const detail = [u.name.toLowerCase().includes(kind.toLowerCase()) ? null : kind, u.location]
          .filter(Boolean)
          .join(' · ');
        return (
          <>
            <Button
              size="sm"
              variant="tertiary"
              className="pfb-unit__code"
              onClick={() => setOpen(u.id)}
            >
              {u.code}
            </Button>
            <div>{u.name}</div>
            {detail ? <div className="u-caption">{detail}</div> : null}
          </>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: (u) => (
        <>
          <StatusPill className="pfb-pill" tone={STATUS_TONES[u.status]}>
            {STATUS_LABELS[u.status]}
          </StatusPill>
          {flagged.has(u.id) ? (
            <StatusPill className="pfb-pill" tone="danger">
              Needs attention
            </StatusPill>
          ) : null}
        </>
      ),
    },
    { id: 'factory', header: 'Factory', cell: (u) => u.factoryName ?? '—' },
    {
      id: 'progress',
      header: 'Fabrication',
      cell: (u) => (u.status === 'planned' ? '—' : `${u.progressPct}%`),
    },
    {
      id: 'qa',
      header: 'QA',
      cell: (u) =>
        u.qaTotal === 0
          ? '—'
          : `${u.qaDone} of ${u.qaTotal}${u.qaFailed > 0 ? ` · ${u.qaFailed} failed` : ''}`,
    },
    {
      id: 'ships',
      header: 'Ships',
      sortValue: (u) => u.shipDate ?? '',
      cell: (u) => fmtDate(u.shipDate),
    },
    {
      id: 'install',
      header: 'Install',
      sortValue: (u) => u.installDate ?? '',
      cell: (u) => fmtDate(u.installDate),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (u) => (
        <Button size="sm" variant="secondary" onClick={() => setOpen(u.id)}>
          Open {u.code}
        </Button>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Prefab and modular"
        description="Pods, panels and modules built off site: fabrication, QA, shipping and install."
        actions={canWrite ? <Button onClick={() => setAdding(true)}>Add a unit</Button> : undefined}
      />
      <ErrorAlert error={units.error} title="We couldn't load the prefab units" />

      {s ? (
        <StatGrid
          items={[
            { label: 'Units', value: s.total, hint: `${s.installedPct}% installed` },
            { label: 'In fabrication', value: s.byStatus.in_fabrication },
            {
              label: 'QA hold',
              value: s.byStatus.qa_hold,
              ...(s.byStatus.qa_hold > 0 ? { tone: 'danger' as const } : {}),
            },
            {
              label: 'Ready or in transit',
              value: s.byStatus.ready_to_ship + s.byStatus.in_transit,
            },
            { label: 'On site', value: s.byStatus.on_site },
            { label: 'Installed', value: s.byStatus.installed, tone: 'success' },
          ]}
        />
      ) : null}

      <NovaPrefabPanel insights={insights.data} units={all} onOpen={setOpen} />

      <DataTable
        caption="Prefab units"
        columns={columns}
        rows={all}
        getRowId={(u) => u.id}
        empty={
          <EmptyState
            title="No prefab units yet"
            description={canWrite ? 'Use Add a unit.' : 'Nothing has been added to this project.'}
          />
        }
      />

      <AddUnitDialog
        open={adding}
        onClose={() => setAdding(false)}
        deliveries={deliveryOptions}
        m={m}
      />
      <UnitDialog
        projectId={project.projectId}
        unitId={open}
        onClose={() => setOpen(null)}
        canWrite={canWrite}
        tz={project.timezone}
        m={m}
      />
    </div>
  );
}
