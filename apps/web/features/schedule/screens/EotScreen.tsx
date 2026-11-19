'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { DelaysIcon } from '@archova/ui/icons';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { EventDialog } from '../components/EventDialog';
import { NewEventDialog } from '../components/NewEventDialog';
import { NovaEotPanel } from '../components/NovaEotPanel';
import { SettingsDialog } from '../components/SettingsDialog';
import type { DelayEvent } from '../data/eot';
import { useDelayEvents, useEotInsights, useEotMutations, useEotSettings } from '../hooks/useEot';
import { clockView, fmtDate, isLive, STATUS_LABELS, STATUS_TONES } from '../lib/eot';
import { CAUSE_LABELS } from '../lib/labels';

/**
 * Delay events and EOT claims (product/08 SCH-US3..6): delays from the diary, RFIs and rain days grouped into an event
 * with an evidence pack, the notice and claim clocks from the contract periods, Nova's draft letters and the
 * superintendent's assessment. People give notice and send claims; Nova flags dates and drafts text.
 */
export function EotScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'delays', id: 'eot' },
  });
  const level = perms.data?.toolLevels.schedule;
  const canWrite =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(level, 'standard');

  const events = useDelayEvents(project.projectId);
  const insights = useEotInsights(project.projectId);
  const settings = useEotSettings(project.projectId);
  const m = useEotMutations(project.projectId);

  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (events.isPending || perms.isPending) return <SkeletonRows label="Loading delay events…" />;
  const all = events.data ?? [];
  const flagged = new Set(
    (insights.data?.flags ?? []).filter((f) => f.severity !== 'low').map((f) => f.eventId),
  );
  const s = insights.data?.summary;

  const columns: DataTableColumn<DelayEvent>[] = [
    {
      id: 'event',
      header: 'Event',
      rowHeader: true,
      sortValue: (e) => e.number,
      cell: (e) => (
        <>
          <strong>{e.ref}</strong> {e.title}
          <span className="u-caption eot-sub">
            {CAUSE_LABELS[e.cause]} · {fmtDate(e.startedOn)}
            {e.endedOn && e.endedOn !== e.startedOn ? ` to ${fmtDate(e.endedOn)}` : ''} ·{' '}
            {e.evidence.items} evidence
          </span>
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (e) => e.status,
      cell: (e) => (
        <>
          <StatusPill tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</StatusPill>
          {flagged.has(e.id) ? <StatusPill tone="danger">Needs attention</StatusPill> : null}
        </>
      ),
    },
    {
      id: 'notice',
      header: 'Notice of delay',
      sortValue: (e) => e.noticeSentOn ?? e.noticeClock.dueOn,
      cell: (e) => {
        const c = clockView(e.noticeClock, e.noticeSentOn, 'notice', isLive(e.status));
        return c.text === '—' ? '—' : <StatusPill tone={c.tone}>{c.text}</StatusPill>;
      },
    },
    {
      id: 'claim',
      header: 'EOT claim',
      sortValue: (e) => e.claimSentOn ?? e.claimClock.dueOn,
      cell: (e) => {
        const c = clockView(e.claimClock, e.claimSentOn, 'claim', isLive(e.status));
        return c.text === '—' ? '—' : <StatusPill tone={c.tone}>{c.text}</StatusPill>;
      },
    },
    {
      id: 'days',
      header: 'Days claimed / granted',
      sortValue: (e) => e.daysClaimed,
      cell: (e) => (
        <span className="u-mono">
          {e.daysClaimed} / {e.daysGranted ?? '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (e) => (
        <Button size="sm" variant="secondary" onClick={() => setOpen(e.id)}>
          Open {e.ref}
        </Button>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="EOT claims"
        description="Group delays into events, watch the notice and claim dates, and have Nova draft the letters."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.delays(org.orgSlug, project.projectId)}
            >
              Delay register
            </Link>
            {canWrite ? (
              <>
                <Button variant="secondary" onClick={() => setConfiguring(true)}>
                  Contract periods
                </Button>
                <Button onClick={() => setAdding(true)}>New delay event</Button>
              </>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={events.error} title="We couldn't load the delay events" />

      {s ? (
        <StatGrid
          items={[
            { label: 'Open events', value: s.open, hint: `${s.events} in total` },
            {
              label: 'Possible EOT in no event',
              value: s.untrackedDelays,
              ...(s.untrackedDelays > 0 ? { tone: 'warning' as const } : {}),
            },
            { label: 'Days claimed', value: s.daysClaimed },
            { label: 'Days granted', value: s.daysGranted, tone: 'success' },
            { label: 'Awaiting assessment', value: s.awaitingAssessment },
            {
              label: 'Contract periods',
              value: s.periodsConfirmed ? 'Confirmed' : 'To check',
              ...(s.periodsConfirmed ? {} : { tone: 'warning' as const }),
            },
          ]}
        />
      ) : null}

      <NovaEotPanel insights={insights.data} events={all} onOpen={setOpen} />

      <DataTable
        caption="Delay events"
        columns={columns}
        rows={all}
        getRowId={(e) => e.id}
        defaultSort={{ columnId: 'event', direction: 'desc' }}
        empty={
          <EmptyState
            icon={DelaysIcon}
            title="No delay events yet"
            description={
              canWrite
                ? 'Use New delay event to group the delays, RFIs and rain days that belong together.'
                : 'No delay events have been recorded on this project.'
            }
          />
        }
      />

      <NewEventDialog
        projectId={project.projectId}
        open={adding}
        onClose={() => setAdding(false)}
        m={m}
      />
      <SettingsDialog
        open={configuring}
        onClose={() => setConfiguring(false)}
        settings={settings.data}
        m={m}
      />
      <EventDialog
        projectId={project.projectId}
        eventId={open}
        onClose={() => setOpen(null)}
        canWrite={canWrite}
        tz={project.timezone}
        m={m}
      />
    </div>
  );
}
