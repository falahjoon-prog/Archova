'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@archova/ui';
import { MeetingsIcon, Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { NewSeriesDialog, StartMeetingDialog } from '../components/SeriesDialogs';
import type { MeetingAction, MeetingSummary } from '../data/api';
import { useMeetingList, useMyActions, useSeries } from '../hooks/useMeetings';
import { carriedLabel } from '../lib/labels';

/** Meetings and the actions that came out of them (product/07). */
export function MeetingsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'meetings', id: 'list' },
  });
  const [tab, setTab] = useState<'meetings' | 'actions'>('meetings');
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const series = useSeries();
  const meetings = useMeetingList();
  const actions = useMyActions(scope);
  const hasSeries = (series.data?.length ?? 0) > 0;
  // Outsiders get no series list; they can't start meetings either.
  const canStart = hasSeries;
  const open = (id: string) => router.push(webRoutes.meeting(org.orgSlug, project.projectId, id));

  const meetingColumns: DataTableColumn<MeetingSummary>[] = [
    {
      id: 'title',
      header: 'Meeting',
      rowHeader: true,
      sortValue: (r) => r.title,
      cell: (r) => (
        <Link className="link" href={webRoutes.meeting(org.orgSlug, project.projectId, r.id)}>
          {r.title}
        </Link>
      ),
    },
    { id: 'series', header: 'Series', sortValue: (r) => r.seriesName, cell: (r) => r.seriesName },
    {
      id: 'held',
      header: 'Held',
      sortValue: (r) => r.heldAt,
      cell: (r) => formatInstant(r.heldAt, project.timezone),
    },
    {
      id: 'status',
      header: 'Minutes',
      sortValue: (r) => r.issuedVersion,
      cell: (r) =>
        r.status === 'issued' ? (
          <StatusPill tone="success">Issued v{r.issuedVersion}</StatusPill>
        ) : (
          <StatusPill tone="neutral">Draft</StatusPill>
        ),
    },
    {
      id: 'open',
      header: 'Open actions',
      align: 'end',
      sortValue: (r) => r.openActions,
      cell: (r) => <span className="u-mono">{r.openActions}</span>,
    },
  ];

  const actionColumns: DataTableColumn<MeetingAction>[] = [
    {
      id: 'no',
      header: 'Item',
      rowHeader: true,
      sortValue: (r) => r.itemNo,
      cell: (r) => <span className="u-mono">{r.itemNo}</span>,
    },
    {
      id: 'body',
      header: 'Action',
      cell: (r) => (
        <>
          <Link
            className="link"
            href={webRoutes.meeting(org.orgSlug, project.projectId, r.meetingId)}
          >
            {r.body}
          </Link>
          {r.stale ? (
            <p className="u-caption u-m-0">
              <StatusPill tone="warning">{carriedLabel(r.carriedCount)}</StatusPill>
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      sortValue: (r) => r.ownerName ?? '',
      cell: (r) => r.ownerName ?? '—',
    },
    {
      id: 'meeting',
      header: 'Meeting',
      sortValue: (r) => r.seriesName,
      cell: (r) => `${r.seriesName} ${r.meetingNumber}`,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (r) => r.dueDate,
      cell: (r) =>
        r.dueDate ? (
          r.isOverdue ? (
            <StatusPill tone="danger">Overdue {formatLocalDate(r.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(r.dueDate)
          )
        ) : (
          <span className="u-muted">—</span>
        ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Meetings"
        description="Minutes, decisions and actions. Open actions carry into the next meeting until someone closes them."
        actions={
          <>
            <Button variant="secondary" onClick={() => setSeriesOpen(true)}>
              New series
            </Button>
            {canStart ? (
              <Button onClick={() => setStartOpen(true)}>
                <Plus size={16} aria-hidden="true" /> Start meeting
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        label="Meetings views"
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        tabs={[
          { id: 'meetings', label: 'Meetings' },
          { id: 'actions', label: 'Actions' },
        ]}
      >
        {tab === 'meetings' ? (
          <>
            <ErrorAlert error={meetings.error} title="We couldn't load the meetings" />
            {meetings.isPending ? (
              <SkeletonRows label="Loading meetings…" />
            ) : (
              <DataTable
                caption="Meetings"
                columns={meetingColumns}
                rows={meetings.data ?? []}
                getRowId={(r) => r.id}
                defaultSort={{ columnId: 'held', direction: 'desc' }}
                empty={
                  <EmptyState
                    icon={MeetingsIcon}
                    title="No meetings yet"
                    description="Create a series, like a weekly site meeting, then start the first meeting."
                    action={<Button onClick={() => setSeriesOpen(true)}>New series</Button>}
                  />
                }
              />
            )}
          </>
        ) : (
          <>
            <div role="group" aria-label="Whose actions" className="bulk-bar">
              <Button
                variant={scope === 'mine' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setScope('mine')}
              >
                Mine and my company’s
              </Button>
              {hasSeries ? (
                <Button
                  variant={scope === 'all' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setScope('all')}
                >
                  Everyone’s
                </Button>
              ) : null}
            </div>
            <ErrorAlert error={actions.error} title="We couldn't load the actions" />
            {actions.isPending ? (
              <SkeletonRows label="Loading actions…" />
            ) : (
              <DataTable
                caption="Open meeting actions"
                columns={actionColumns}
                rows={actions.data ?? []}
                getRowId={(r) => r.id}
                defaultSort={{ columnId: 'due', direction: 'asc' }}
                empty={
                  <EmptyState
                    title="No open actions"
                    description="Actions from issued minutes show here."
                  />
                }
              />
            )}
          </>
        )}
      </Tabs>
      <NewSeriesDialog open={seriesOpen} onClose={() => setSeriesOpen(false)} />
      {series.data && hasSeries ? (
        <StartMeetingDialog
          key={startOpen ? 'open' : 'closed'}
          open={startOpen}
          onClose={() => setStartOpen(false)}
          series={series.data}
          onStarted={open}
        />
      ) : null}
    </div>
  );
}
