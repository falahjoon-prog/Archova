'use client';

import { useState } from 'react';
import {
  PageHeader,
  Button,
  DataTable,
  EmptyState,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { TmTicketDetailCard, STATUS } from '../components/TmTicketDetail';
import { TmTicketForm } from '../components/TmTicketForm';
import type { TmTicket } from '../data/api';
import { useTmTickets } from '../hooks/useTmTickets';
import { aud } from '../lib/tm';

const label = (n: number) => `T&M-${String(n).padStart(4, '0')}`;

/** Daywork recorded on site: raised (or drafted by Nova from the day’s timesheets), signed by two people, then converted. */
export function TmTicketsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const q = useTmTickets(project.projectId);
  const [openId, setOpenId] = useState<string | null>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: openId ? { type: 'tm_ticket', id: openId } : { type: 'tm_tickets', id: 'tm_tickets' },
  });
  const level = perms.data?.toolLevels.payment_claims;
  const isOwner = perms.data?.orgRole === 'owner' || perms.data?.orgRole === 'admin';
  const canManage = isOwner || atLeast(level, 'standard');
  const canConvert = isOwner || atLeast(level, 'admin');

  const columns: DataTableColumn<TmTicket>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (t) => t.number,
      cell: (t) => label(t.number),
    },
    {
      id: 'date',
      header: 'Work date',
      sortValue: (t) => t.workDate,
      cell: (t) => formatLocalDate(t.workDate),
    },
    {
      id: 'what',
      header: 'Ticket',
      cell: (t) => (
        <>
          <span>{t.title}</span>
          <p className="u-m-0 u-caption">
            {[t.location, t.contractor].filter(Boolean).join(' · ')}
          </p>
        </>
      ),
    },
    {
      id: 'total',
      header: 'Total (ex GST)',
      align: 'end',
      sortValue: (t) => Number(t.total),
      cell: (t) => <span className="u-mono u-nowrap">{aud(t.total)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => <StatusPill tone={STATUS[t.status]!.tone}>{STATUS[t.status]!.label}</StatusPill>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (t) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(t.id)}>
          Open {label(t.number)}
        </Button>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="T&M tickets"
        description="Daywork for labour, equipment and materials, signed on site by two people, then converted into cost or a variation."
      />
      <ErrorAlert error={q.error} title="We couldn't load the T&M tickets" />
      {q.data ? (
        <p className="u-m-0">
          {q.data.awaitingSignature} awaiting signature · {q.data.unconverted} signed, not yet
          converted · total <span className="u-mono">{aud(q.data.total)}</span> ex GST
        </p>
      ) : null}
      <DataTable
        caption="T&M tickets"
        columns={columns}
        rows={q.data?.data ?? []}
        getRowId={(t) => t.id}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No T&M tickets"
            description="Raise one for daywork that is not in the contract, or let Nova draft it from a day’s timesheets."
          />
        }
      />
      {openId ? (
        <TmTicketDetailCard
          id={openId}
          canManage={canManage}
          canSign={canManage}
          canConvert={canConvert}
          onClose={() => setOpenId(null)}
        />
      ) : null}
      {canManage ? <TmTicketForm onCreated={setOpenId} /> : null}
    </div>
  );
}
