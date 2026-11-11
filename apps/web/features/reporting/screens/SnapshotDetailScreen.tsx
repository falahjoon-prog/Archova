'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@archova/ui';
import { useRouter } from 'next/navigation';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useDeleteSnapshot, usePortfolio, useSnapshot } from '../hooks/useReporting';
import { SNAPSHOT_COMPARE_ROWS, compareTotal, type DashboardSnapshotDetail } from '../lib/types';
import { TileBoard, type TileContext } from '@/features/dashboard';
import { useBranding } from '@/features/branding';
import { QualitySafety } from '../components/QualitySafety';
import { ProjectOverviewTable } from '../components/ProjectOverviewTable';
import { StatusReport } from '../components/StatusReport';
import { DEFAULT_WIDGETS, defaultLayout } from './PortfolioScreen';

interface CompareRow {
  label: string;
  then: number;
  now: number;
  change: number;
  text: string;
  risingIsBad: boolean;
}

function Compare({ snapshot }: { snapshot: DashboardSnapshotDetail }) {
  const live = usePortfolio(false);
  if (live.isPending) return <SkeletonRows label="Loading today's figures…" />;
  if (!live.data) return <ErrorAlert error={live.error} title="We couldn't load today's figures" />;
  const now = live.data.totals;
  const rows: CompareRow[] = SNAPSHOT_COMPARE_ROWS.map((r) => {
    const c = compareTotal(Number(snapshot.dashboard.totals[r.key]), Number(now[r.key]));
    return {
      label: r.label,
      then: c.then,
      now: c.now,
      change: c.change,
      text: c.label,
      risingIsBad: r.risingIsBad,
    };
  });
  const columns: DataTableColumn<CompareRow>[] = [
    { id: 'measure', header: 'Measure', rowHeader: true, cell: (r) => r.label },
    {
      id: 'then',
      header: `As at ${formatLocalDate(snapshot.currentAsOf)}`,
      align: 'end',
      cell: (r) => r.then,
    },
    { id: 'now', header: 'Today', align: 'end', cell: (r) => r.now },
    {
      id: 'change',
      header: 'Change',
      align: 'end',
      cell: (r) =>
        r.change === 0 ? (
          <span className="u-muted">{r.text}</span>
        ) : (
          <StatusPill tone={r.change > 0 === r.risingIsBad ? 'danger' : 'success'}>
            {r.text}
          </StatusPill>
        ),
    },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Snapshot compared with today"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.label}
      />
      <p className="u-caption u-muted">
        Today's figures cover the open projects you can see now. Red means more of something that
        needs chasing; green means fewer.
      </p>
    </div>
  );
}

/** The saved numbers laid out on the company's current tile board, with the other dashboard views beside it. */
function SnapshotDashboard({
  snapshot,
  view,
}: {
  snapshot: DashboardSnapshotDetail;
  view: string;
}) {
  const org = useCurrentOrg();
  const branding = useBranding().data;
  const portfolio = snapshot.dashboard;
  if (view === 'status') return <StatusReport portfolio={portfolio} />;
  if (view === 'project-overview') return <ProjectOverviewTable portfolio={portfolio} />;
  if (view === 'quality-safety') return <QualitySafety portfolio={portfolio} />;
  const tiles =
    branding?.dashboardLayout ?? defaultLayout(branding?.dashboardWidgets ?? DEFAULT_WIDGETS);
  const ctx: TileContext = {
    surface: 'portfolio',
    orgId: org.orgId,
    orgSlug: org.orgSlug,
    data: portfolio,
  };
  return <TileBoard tiles={tiles} ctx={ctx} />;
}

/** A saved dashboard reopened exactly as it was, with a comparison against today. */
export function SnapshotDetailScreen({ snapshotId }: { snapshotId: string }) {
  const org = useCurrentOrg();
  const router = useRouter();
  const snapshot = useSnapshot(snapshotId);
  const remove = useDeleteSnapshot();
  const [view, setView] = useState('dashboard');
  const [confirm, setConfirm] = useState(false);
  const data = snapshot.data;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.snapshots(org.orgSlug)}>
            Snapshots
          </Link>
        }
        title={data?.title ?? 'Snapshot'}
        description={
          data
            ? `Current as of ${formatLocalDate(data.currentAsOf)}. Taken ${formatInstant(
                data.createdAt,
                Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              )} by ${data.createdBy.name ?? 'a former member'}${data.program ? ` · ${data.program}` : ''}.`
            : undefined
        }
        actions={
          data ? (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          ) : undefined
        }
      />
      <ErrorAlert error={snapshot.error} title="We couldn't open this snapshot" />
      {snapshot.isPending ? <SkeletonRows label="Loading the snapshot…" /> : null}
      {data ? (
        <>
          <Alert tone="info" title="This is a saved copy">
            The figures below are frozen as they were when the snapshot was taken and do not change.
            Tiles are laid out as your company's dashboard is today, and Sustainability is not part
            of a snapshot.
          </Alert>
          <Tabs
            label="Snapshot views"
            tabs={[
              { id: 'dashboard', label: 'Overview' },
              { id: 'status', label: 'Status report' },
              { id: 'project-overview', label: 'Project overview' },
              { id: 'quality-safety', label: 'Quality & Safety' },
              { id: 'compare', label: 'Compare with today' },
            ]}
            value={view}
            onValueChange={setView}
          >
            {view === 'compare' ? (
              <Compare snapshot={data} />
            ) : (
              <SnapshotDashboard snapshot={data} view={view} />
            )}
          </Tabs>
        </>
      ) : null}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this snapshot?"
        description="The saved figures are removed for everyone. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(snapshotId, {
                  onSuccess: () => router.push(webRoutes.snapshots(org.orgSlug)),
                })
              }
            >
              Delete snapshot
            </Button>
          </>
        }
      >
        <ErrorAlert error={remove.error} title="We couldn't delete the snapshot" />
      </Dialog>
    </div>
  );
}
