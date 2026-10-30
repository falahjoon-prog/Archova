'use client';

import Link from 'next/link';
import {
  DataTable,
  buttonClassName,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { Plus, TransmittalsIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useTransmittals } from '../hooks/useTransmittals';
import { PURPOSE_LABELS, formatTransmittalNumber, type Transmittal } from '../lib/types';

export function TransmittalListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'transmittals', id: 'register' },
  });
  const list = useTransmittals(project.projectId);
  const href = (t: Transmittal) => webRoutes.transmittal(org.orgSlug, project.projectId, t.id);

  const columns: DataTableColumn<Transmittal>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (t) => t.number ?? Number.MAX_SAFE_INTEGER,
      cell: (t) => (
        <Link className="link u-mono" href={href(t)}>
          {formatTransmittalNumber(t.number)}
        </Link>
      ),
    },
    { id: 'subject', header: 'Subject', sortValue: (t) => t.subject, cell: (t) => t.subject },
    { id: 'purpose', header: 'Purpose', cell: (t) => PURPOSE_LABELS[t.purpose] },
    {
      id: 'status',
      header: 'Status',
      sortValue: (t) => t.status,
      cell: (t) =>
        t.status === 'sent' ? (
          <StatusPill tone="success">Sent</StatusPill>
        ) : (
          <StatusPill tone="neutral">Draft</StatusPill>
        ),
    },
    {
      id: 'sent',
      header: 'Sent',
      sortValue: (t) => t.sentAt ?? '',
      cell: (t) => (t.sentAt ? formatInstant(t.sentAt, project.timezone) : '—'),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Transmittals"
        description="Send drawings and documents to the people who need them, and see who has opened them."
        actions={
          <Link
            href={webRoutes.newTransmittal(org.orgSlug, project.projectId)}
            className={buttonClassName('primary')}
          >
            <Plus size={16} aria-hidden="true" /> New transmittal
          </Link>
        }
      />
      <ErrorAlert error={list.error} title="We couldn't load transmittals" />
      {list.isPending ? (
        <SkeletonRows label="Loading transmittals…" />
      ) : (
        <DataTable
          caption="Transmittals"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(t) => t.id}
          defaultSort={{ columnId: 'number', direction: 'desc' }}
          empty={
            <EmptyState
              icon={TransmittalsIcon}
              title="No transmittals yet"
              description="A transmittal is the record that you sent a set of drawings or documents, to whom and when."
              action={
                <Link
                  href={webRoutes.newTransmittal(org.orgSlug, project.projectId)}
                  className={buttonClassName('primary')}
                >
                  <Plus size={16} aria-hidden="true" /> New transmittal
                </Link>
              }
            />
          }
        />
      )}
    </div>
  );
}
