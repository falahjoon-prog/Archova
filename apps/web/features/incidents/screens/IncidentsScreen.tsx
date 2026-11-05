'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { IncidentsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useIncidentList, useIncidentMutations } from '../hooks/useIncidents';
import {
  SEVERITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  TYPES,
  TYPE_LABELS,
  type Incident,
  type IncidentStatus,
  type IncidentType,
} from '../lib/types';
import { IncidentDetailView } from './IncidentDetailView';
import { ReportDialog } from './dialogs';
import { SEVERITY_TONE, STATUS_TONE } from './tones';

/** The incident register. `?id=` opens one incident with its people, corrective actions and history. */
export function IncidentsScreen() {
  const [params, setParams] = useUrlState(['status', 'type', 'id'] as const);
  return params.id ? (
    <IncidentDetailView id={params.id} />
  ) : (
    <IncidentList
      status={params.status}
      type={params.type}
      setFilter={(k, v) => setParams({ [k]: v })}
    />
  );
}

function IncidentList({
  status,
  type,
  setFilter,
}: {
  status: string;
  type: string;
  setFilter: (key: 'status' | 'type', v: string) => void;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const validStatus = STATUSES.includes(status as IncidentStatus)
    ? (status as IncidentStatus)
    : undefined;
  const validType = TYPES.includes(type as IncidentType) ? (type as IncidentType) : undefined;
  const list = useIncidentList({ status: validStatus, type: validType });
  const m = useIncidentMutations();
  const [reporting, setReporting] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'incident', id: 'register' },
  });

  const columns: DataTableColumn<Incident>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (i) => i.numberLabel,
      cell: (i) => (
        <Link
          href={webRoutes.incidents(org.orgSlug, project.projectId, i.id)}
          aria-label={`${i.numberLabel} ${i.title}`}
        >
          {i.numberLabel}
        </Link>
      ),
    },
    { id: 'title', header: 'Incident', sortValue: (i) => i.title, cell: (i) => i.title },
    { id: 'type', header: 'Type', sortValue: (i) => i.type, cell: (i) => TYPE_LABELS[i.type] },
    {
      id: 'occurred',
      header: 'When',
      sortValue: (i) => i.occurredAt,
      cell: (i) => formatInstant(i.occurredAt, project.timezone),
    },
    {
      id: 'severity',
      header: 'Severity',
      sortValue: (i) => i.severity,
      cell: (i) => (
        <StatusPill tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABELS[i.severity]}</StatusPill>
      ),
    },
    {
      id: 'notifiable',
      header: 'Notifiable',
      cell: (i) => (i.isNotifiable ? <StatusPill tone="danger">Notifiable</StatusPill> : '—'),
    },
    {
      id: 'actions',
      header: 'Open actions',
      sortValue: (i) => i.openActions,
      cell: (i) => i.openActions,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => i.status,
      cell: (i) => <StatusPill tone={STATUS_TONE[i.status]}>{STATUS_LABELS[i.status]}</StatusPill>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Incidents"
        description="Report incidents and near misses, find the cause and track the corrective actions until they are verified."
        actions={
          <Button onClick={() => setReporting(true)}>
            <Plus size={16} aria-hidden="true" /> Report incident
          </Button>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Incidents" /> : null}
      <FilterBar label="Filter incidents">
        <Select
          label="Status"
          value={status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setFilter('status', e.target.value)}
        />
        <Select
          label="Type"
          value={type}
          placeholder="Any type"
          options={TYPES.map((v) => ({ value: v, label: TYPE_LABELS[v] }))}
          onChange={(e) => setFilter('type', e.target.value)}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load incidents" />
      {list.isPending ? (
        <SkeletonRows label="Loading incidents…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={IncidentsIcon}
          title={validStatus || validType ? 'No incidents match' : 'No incidents reported'}
          description={
            validStatus || validType
              ? 'Try different filters.'
              : 'Report anything that hurt someone or nearly did, however small.'
          }
        />
      ) : (
        <DataTable
          caption="Incidents"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(i) => i.id}
        />
      )}
      {reporting ? (
        <ReportDialog
          dir={dir}
          timeZone={project.timezone}
          pending={m.report.isPending}
          error={m.report.error}
          onClose={() => setReporting(false)}
          onSave={(input) => m.report.mutate(input, { onSuccess: () => setReporting(false) })}
        />
      ) : null}
    </>
  );
}
