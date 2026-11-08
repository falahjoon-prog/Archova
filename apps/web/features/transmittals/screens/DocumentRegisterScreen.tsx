'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  ToggleGroup,
  type DataTableColumn,
} from '@archova/ui';
import { TransmittalsIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useDocumentRegister } from '../hooks/useTransmittals';
import {
  FLAG_LABELS,
  RECIPIENT_STATUS_LABELS,
  RECIPIENT_STATUS_TONE,
  acknowledgementSummary,
  flagRank,
  type RegisterFlag,
  type RegisterRecipient,
  type RegisterRow,
} from '../lib/types';

type View = 'attention' | 'all';

const FLAG_TONE = { high: 'danger', medium: 'warning', low: 'info' } as const;

/**
 * Document control register: each drawing and document with its current revision, who was sent which revision, and
 * acknowledgement status. Nova's flags are rule-based (no model call): overdue or outstanding acknowledgements,
 * superseded revisions still in use, and recipients missing the current revision.
 */
export function DocumentRegisterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'transmittals', id: 'document-register' },
  });
  const register = useDocumentRegister(project.projectId);
  const [view, setView] = useState<View>('attention');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => register.data ?? [], [register.data]);
  const flagged = useMemo(() => rows.filter((r) => r.flags.length > 0), [rows]);
  const shown = view === 'attention' ? flagged : rows;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const totals = useMemo(() => {
    const t = new Map<RegisterFlag['kind'], number>();
    for (const r of rows) for (const f of r.flags) t.set(f.kind, (t.get(f.kind) ?? 0) + 1);
    return [...t.entries()];
  }, [rows]);

  const columns: DataTableColumn<RegisterRow>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (r) => r.number ?? r.title,
      cell: (r) => (
        <button
          type="button"
          className="link u-mono"
          aria-pressed={r.id === selectedId}
          onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
        >
          {r.number ?? '—'}
        </button>
      ),
    },
    { id: 'title', header: 'Title', sortValue: (r) => r.title, cell: (r) => r.title },
    {
      id: 'kind',
      header: 'Type',
      sortValue: (r) => r.kind,
      cell: (r) => (r.kind === 'drawing' ? 'Drawing' : 'Document'),
    },
    {
      id: 'rev',
      header: 'Current rev',
      sortValue: (r) => r.currentRev,
      cell: (r) => r.currentRev ?? '—',
    },
    {
      id: 'distribution',
      header: 'Distribution',
      cell: (r) => acknowledgementSummary(r.recipients),
    },
    {
      id: 'flags',
      header: 'Nova flags',
      sortValue: (r) => -flagRank(r.flags),
      cell: (r) =>
        r.flags.length ? (
          <span className="row">
            {r.flags.map((f) => (
              <StatusPill key={f.kind} tone={FLAG_TONE[f.severity]}>
                {FLAG_LABELS[f.kind]}
              </StatusPill>
            ))}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  const recipientColumns: DataTableColumn<RegisterRecipient>[] = [
    {
      id: 'who',
      header: 'Recipient',
      rowHeader: true,
      sortValue: (r) => r.email,
      cell: (r) => (r.name ? `${r.name} (${r.email})` : r.email),
    },
    { id: 'role', header: 'Role', cell: (r) => (r.role === 'to' ? 'To' : 'Cc') },
    { id: 'rev', header: 'Last sent rev', sortValue: (r) => r.rev, cell: (r) => r.rev },
    {
      id: 'transmittal',
      header: 'Transmittal',
      sortValue: (r) => r.transmittalNumber,
      cell: (r) => (
        <Link
          className="link u-mono"
          href={webRoutes.transmittal(org.orgSlug, project.projectId, r.transmittalId)}
        >
          T-{String(r.transmittalNumber).padStart(4, '0')}
        </Link>
      ),
    },
    {
      id: 'sent',
      header: 'Sent',
      sortValue: (r) => r.sentAt,
      cell: (r) => formatInstant(r.sentAt, project.timezone),
    },
    {
      id: 'ack',
      header: 'Acknowledged',
      sortValue: (r) => r.acknowledgedAt,
      cell: (r) => (r.acknowledgedAt ? formatInstant(r.acknowledgedAt, project.timezone) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      cell: (r) => (
        <StatusPill tone={RECIPIENT_STATUS_TONE[r.status]}>
          {RECIPIENT_STATUS_LABELS[r.status]}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Document register"
        description="Every drawing and document with its current revision, who was sent which revision, and who has acknowledged it."
        actions={
          <Link href={webRoutes.transmittals(org.orgSlug, project.projectId)} className="link">
            Transmittals
          </Link>
        }
      />
      <ErrorAlert error={register.error} title="We couldn't load the document register" />
      {register.isPending ? (
        <SkeletonRows label="Loading the document register…" />
      ) : (
        <>
          <Card title="Nova flags">
            {totals.length ? (
              <ul className="row" aria-label="Flags across the register">
                {totals.map(([kind, n]) => (
                  <li key={kind}>
                    <StatusPill tone={kind === 'not_distributed' ? 'info' : 'warning'}>
                      {FLAG_LABELS[kind]}: {n}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Nothing needs chasing. Every current revision has gone out and been acknowledged.
              </p>
            )}
          </Card>
          <ToggleGroup
            label="Show"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'attention', label: `Needs attention (${flagged.length})` },
              { value: 'all', label: `All (${rows.length})` },
            ]}
          />
          <DataTable
            caption="Document register"
            columns={columns}
            rows={shown}
            getRowId={(r) => r.id}
            defaultSort={{ columnId: view === 'attention' ? 'flags' : 'number', direction: 'asc' }}
            empty={
              <EmptyState
                icon={TransmittalsIcon}
                title={view === 'attention' ? 'Nothing needs attention' : 'Nothing registered yet'}
                description={
                  view === 'attention'
                    ? 'Switch to All to see every drawing and document.'
                    : 'Publish a drawing set or add a document, then issue it on a transmittal.'
                }
              />
            }
          />
          {selected ? (
            <Card title={`${selected.number ?? selected.title} — who has what`}>
              {selected.flags.length ? (
                <ul>
                  {selected.flags.map((f) => (
                    <li key={f.kind}>{f.message}</li>
                  ))}
                </ul>
              ) : null}
              <DataTable
                caption={`Recipients of ${selected.number ?? selected.title}`}
                columns={recipientColumns}
                rows={selected.recipients}
                getRowId={(r) => r.email}
                density="compact"
                empty={
                  <EmptyState
                    icon={TransmittalsIcon}
                    title="Not issued yet"
                    description="No sent transmittal includes this revision."
                  />
                }
              />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
