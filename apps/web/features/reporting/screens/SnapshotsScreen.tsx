'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { DocumentsIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCreateSnapshot, useSnapshots } from '../hooks/useReporting';
import type { DashboardSnapshot } from '../lib/types';

/** Today in the viewer's own time zone, `YYYY-MM-DD`. */
const localToday = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Saved copies of the portfolio dashboard, each one a point in time that can be reopened exactly as it was. */
export function SnapshotsScreen() {
  const org = useCurrentOrg();
  const snapshots = useSnapshots();
  const create = useCreateSnapshot();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [asOf, setAsOf] = useState(localToday);
  const [program, setProgram] = useState('');

  const reset = () => {
    setOpen(false);
    setTitle('');
    setAsOf(localToday());
    setProgram('');
    create.reset();
  };

  const columns: DataTableColumn<DashboardSnapshot>[] = [
    {
      id: 'title',
      header: 'Snapshot title',
      rowHeader: true,
      sortValue: (r) => r.title,
      cell: (r) => (
        <Link className="link" href={webRoutes.snapshot(org.orgSlug, r.id)}>
          {r.title}
        </Link>
      ),
    },
    {
      id: 'asOf',
      header: 'Current as of',
      sortValue: (r) => r.currentAsOf,
      cell: (r) => formatLocalDate(r.currentAsOf),
    },
    {
      id: 'created',
      header: 'Date created',
      sortValue: (r) => r.createdAt,
      cell: (r) => formatInstant(r.createdAt, viewerZone()),
    },
    {
      id: 'by',
      header: 'Created by',
      sortValue: (r) => r.createdBy.name ?? '',
      cell: (r) => r.createdBy.name ?? 'Former member',
    },
    {
      id: 'program',
      header: 'Programme',
      sortValue: (r) => r.program ?? '',
      cell: (r) => r.program ?? <span className="u-muted">—</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="Snapshots"
        description="A snapshot saves the whole portfolio dashboard and its figures as they are now. Open one later to see the dashboard exactly as it was, or compare it with today. You see your own snapshots; owners and admins see everyone's."
        actions={<Button onClick={() => setOpen(true)}>Take snapshot</Button>}
      />
      <ErrorAlert error={snapshots.error} title="We couldn't load the snapshots" />
      {snapshots.isPending ? (
        <SkeletonRows label="Loading the snapshots…" />
      ) : (
        <DataTable
          caption="Dashboard snapshots"
          columns={columns}
          rows={snapshots.data ?? []}
          getRowId={(r) => r.id}
          defaultSort={{ columnId: 'asOf', direction: 'desc' }}
          empty={
            <EmptyState
              icon={DocumentsIcon}
              title="No snapshots yet"
              description="Take a snapshot at month end, for example “Monthly Report - Nov 2026”, to keep the dashboard as it stood."
            />
          }
        />
      )}
      <Dialog
        open={open}
        onClose={reset}
        title="Take snapshot"
        description="Saves the portfolio dashboard as you see it now. It cannot be edited afterwards."
        footer={
          <>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!title.trim()}
              onClick={() =>
                create.mutate(
                  {
                    title: title.trim(),
                    currentAsOf: asOf || undefined,
                    program: program.trim() || null,
                  },
                  { onSuccess: reset },
                )
              }
            >
              Save snapshot
            </Button>
          </>
        }
      >
        <div className="stack">
          <ErrorAlert error={create.error} title="We couldn't save the snapshot" />
          <TextField
            label="Snapshot title"
            value={title}
            maxLength={120}
            placeholder="Monthly Report - Nov 2026"
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            label="Current as of"
            type="date"
            value={asOf}
            max={localToday()}
            onChange={(e) => setAsOf(e.target.value)}
          />
          <TextField
            label="Programme (optional)"
            value={program}
            maxLength={80}
            onChange={(e) => setProgram(e.target.value)}
          />
        </div>
      </Dialog>
    </div>
  );
}
