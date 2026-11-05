'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
  Dialog,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useTransmittal, useTransmittalMutations } from '../hooks/useTransmittals';
import {
  PURPOSE_LABELS,
  RECEIPT_LABELS,
  formatTransmittalNumber,
  receiptState,
  type ReceiptState,
  type TransmittalItem,
  type TransmittalRecipient,
} from '../lib/types';

const TONES: Record<ReceiptState, StatusTone> = {
  acknowledged: 'success',
  downloaded: 'success',
  opened: 'info',
  sent: 'neutral',
  not_sent: 'warning',
};

export function TransmittalDetailScreen({ transmittalId }: { transmittalId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'transmittals', id: transmittalId },
  });
  const query = useTransmittal(project.projectId, transmittalId);
  const { send, resend } = useTransmittalMutations(project.projectId);
  const [confirming, setConfirming] = useState(false);
  const detail = query.data;
  const t = detail?.transmittal;
  const tz = project.timezone;
  const when = (iso: string | null) => (iso ? formatInstant(iso, tz) : '—');

  const items: DataTableColumn<TransmittalItem>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      cell: (i) => <span className="u-mono">{i.number ?? '—'}</span>,
    },
    { id: 'title', header: 'Title', cell: (i) => i.title },
    {
      id: 'type',
      header: 'Type',
      cell: (i) => (i.revisionType === 'drawing' ? 'Drawing' : 'Document'),
    },
    { id: 'rev', header: 'Rev', cell: (i) => <span className="u-mono">{i.rev}</span> },
  ];

  const recipients: DataTableColumn<TransmittalRecipient>[] = [
    {
      id: 'who',
      header: 'Recipient',
      rowHeader: true,
      cell: (r) => (
        <>
          {r.name ? <strong>{r.name}</strong> : null}
          <span className={r.name ? 'u-caption u-block' : undefined}>{r.email}</span>
        </>
      ),
    },
    { id: 'role', header: 'To / Cc', cell: (r) => (r.role === 'cc' ? 'Cc' : 'To') },
    ...(t?.status === 'sent'
      ? ([
          {
            id: 'state',
            header: 'Status',
            cell: (r) => {
              const s = receiptState(r);
              return <StatusPill tone={TONES[s]}>{RECEIPT_LABELS[s]}</StatusPill>;
            },
          },
          { id: 'opened', header: 'Opened', cell: (r) => when(r.openedAt) },
          { id: 'downloaded', header: 'Downloaded', cell: (r) => when(r.downloadedAt) },
          { id: 'acknowledged', header: 'Acknowledged', cell: (r) => when(r.acknowledgedAt) },
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (r) =>
              r.userId ? null : (
                <Button
                  size="sm"
                  variant="tertiary"
                  loading={resend.isPending && resend.variables?.recipientId === r.id}
                  aria-label={`Email ${r.email} a new link`}
                  onClick={() => resend.mutate({ id: transmittalId, recipientId: r.id })}
                >
                  Resend link
                </Button>
              ),
          },
        ] satisfies DataTableColumn<TransmittalRecipient>[])
      : []),
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.transmittals(org.orgSlug, project.projectId)}>
            Transmittals
          </Link>
        }
        title={t ? `${formatTransmittalNumber(t.number)} ${t.subject}` : 'Transmittal'}
        actions={
          t?.status === 'draft' ? <Button onClick={() => setConfirming(true)}>Send…</Button> : null
        }
      />
      <ErrorAlert error={query.error} title="We couldn't load this transmittal" />
      <ErrorAlert error={resend.error} title="We couldn't resend the link" />
      {query.isPending ? <SkeletonRows label="Loading transmittal…" /> : null}
      {detail && t ? (
        <>
          {t.status === 'draft' ? (
            <Alert tone="info" title="Draft">
              Nobody has been told yet. Check the items and recipients, then send. A sent
              transmittal can&apos;t be changed.
            </Alert>
          ) : null}
          <section className="ac-card" aria-labelledby="tx-summary">
            <h2 id="tx-summary" className="panel-heading">
              Summary
            </h2>
            <DescriptionList
              items={[
                { label: 'Purpose', value: PURPOSE_LABELS[t.purpose] },
                { label: 'Sent', value: when(t.sentAt) },
                {
                  label: 'Response due',
                  value: t.responseDue ? formatLocalDate(t.responseDue) : '—',
                },
                ...(t.message ? [{ label: 'Message', value: t.message }] : []),
              ]}
            />
          </section>
          <section className="stack" aria-labelledby="tx-items">
            <h2 id="tx-items" className="panel-heading">
              Items ({detail.items.length})
            </h2>
            <DataTable
              caption="Items on this transmittal"
              columns={items}
              rows={detail.items}
              getRowId={(i) => `${i.revisionType}:${i.revisionId}`}
            />
          </section>
          <section className="stack" aria-labelledby="tx-recipients">
            <h2 id="tx-recipients" className="panel-heading">
              {t.status === 'sent' ? 'Receipts' : 'Recipients'}
            </h2>
            <DataTable
              caption={t.status === 'sent' ? 'Receipts by recipient' : 'Recipients'}
              columns={recipients}
              rows={detail.recipients}
              getRowId={(r) => r.id}
            />
          </section>
        </>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send this transmittal?"
        description={`It goes to ${detail?.recipients.length ?? 0} ${detail?.recipients.length === 1 ? 'person' : 'people'} and can't be changed afterwards.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              loading={send.isPending}
              onClick={() =>
                t &&
                send.mutate(
                  { id: transmittalId, version: t.version },
                  { onSuccess: () => setConfirming(false) },
                )
              }
            >
              Send transmittal
            </Button>
          </>
        }
      >
        <ErrorAlert error={send.error} title="We couldn't send it" />
      </Dialog>
    </div>
  );
}
