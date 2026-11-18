'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { DocumentsIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useAuditLog, useProjectChoices } from '../hooks/useReporting';
import {
  AUDIT_MODULE_LABELS,
  EMPTY_AUDIT_FILTERS,
  type AuditEvent,
  type AuditFilters,
} from '../lib/types';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function Actor({ actor }: { actor: AuditEvent['actor'] }) {
  if (actor.kind === 'user') return <>{actor.name ?? 'Former member'}</>;
  if (actor.kind === 'link') return <StatusPill tone="neutral">Access link</StatusPill>;
  return <StatusPill tone="neutral">System</StatusPill>;
}

/** Who did what, when, across the company. Org owners and admins only (the page is hidden from everyone else). */
export function AuditLogScreen() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const log = useAuditLog(filters);
  const projects = useProjectChoices();
  const patch = (p: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...p }));
  const tz = useMemo(zone, []);
  const rows = useMemo(() => log.data?.pages.flatMap((p) => p.data) ?? [], [log.data]);
  const filtered = Object.values(filters).some(Boolean);

  const columns: DataTableColumn<AuditEvent>[] = [
    {
      id: 'when',
      header: 'When',
      rowHeader: true,
      cell: (r) => formatInstant(r.at, tz),
    },
    { id: 'who', header: 'Who', cell: (r) => <Actor actor={r.actor} /> },
    {
      id: 'what',
      header: 'What',
      cell: (r) => (
        <>
          {r.summary} <span className="u-muted u-caption">{r.action}</span>
        </>
      ),
    },
    {
      id: 'project',
      header: 'Project',
      cell: (r) => r.projectName ?? <span className="u-muted">Company</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="Audit log"
        description={`Who changed what, and when, across every project. Times are shown in your time zone (${tz}). Details of each change are not shown here.`}
      />
      <div className="form-row">
        <Select
          label="Project"
          value={filters.projectId}
          placeholder="All projects"
          options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => patch({ projectId: e.target.value })}
        />
        <Select
          label="Area"
          value={filters.module}
          placeholder="Everything"
          options={Object.entries(AUDIT_MODULE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => patch({ module: e.target.value })}
        />
        <TextField
          label="From"
          type="date"
          value={filters.from}
          onChange={(e) => patch({ from: e.target.value })}
        />
        <TextField
          label="To"
          type="date"
          value={filters.to}
          onChange={(e) => patch({ to: e.target.value })}
        />
      </div>
      {filtered ? (
        <div>
          <Button variant="tertiary" onClick={() => setFilters(EMPTY_AUDIT_FILTERS)}>
            Clear filters
          </Button>
        </div>
      ) : null}
      <ErrorAlert error={log.error} title="We couldn't load the audit log" />
      {log.isPending ? (
        <SkeletonRows label="Loading the audit log…" />
      ) : (
        <DataTable
          caption="Audit log, newest first"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          empty={
            <EmptyState
              icon={DocumentsIcon}
              title={filtered ? 'Nothing matches those filters' : 'Nothing recorded yet'}
              description={
                filtered
                  ? 'Try a wider date range or another project.'
                  : 'Changes made by your team appear here as they happen.'
              }
            />
          }
        />
      )}
      {log.hasNextPage ? (
        <div>
          <Button
            variant="secondary"
            loading={log.isFetchingNextPage}
            onClick={() => log.fetchNextPage()}
          >
            Load older entries
          </Button>
        </div>
      ) : rows.length > 0 ? (
        <Alert tone="info" title="That is everything">
          No older entries match.
        </Alert>
      ) : null}
    </div>
  );
}
