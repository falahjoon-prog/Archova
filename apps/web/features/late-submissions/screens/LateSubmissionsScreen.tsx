'use client';

import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { LateSubmissionsIcon } from '@archova/ui/icons';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { LateStatus, LateSubmission } from '../data/api';
import { useLateSubmissionMutations, useLateSubmissions } from '../hooks/useLateSubmissions';

const STATUSES: LateStatus[] = ['pending', 'accepted', 'rejected'];
const STATUS_LABEL: Record<LateStatus, string> = {
  pending: 'Waiting for review',
  accepted: 'Accepted',
  rejected: 'Rejected',
};
const STATUS_TONE: Record<LateStatus, StatusTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'neutral',
};

/** "diary.createEntry" -> "Diary: create entry". */
const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .toLowerCase();
export function describeChange(module: string, command: string): string {
  const m = words(module);
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}: ${words(command)}`;
}

/** Changes held because the sender's access ended before their phone sent them (X38). */
export function LateSubmissionsScreen() {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const [params, setParams] = useUrlState(['status'] as const);
  const status = STATUSES.includes(params.status as LateStatus)
    ? (params.status as LateStatus)
    : 'pending';
  const list = useLateSubmissions(status);
  const m = useLateSubmissionMutations();
  const [rejecting, setRejecting] = useState<LateSubmission | null>(null);
  const [note, setNote] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const at = (iso: string) => formatInstant(iso, project.timezone);

  const columns: DataTableColumn<LateSubmission>[] = [
    {
      id: 'what',
      header: 'Change',
      rowHeader: true,
      cell: (s) => describeChange(s.module, s.command),
    },
    { id: 'by', header: 'Sent by', cell: (s) => dir.personName(s.submittedBy) },
    {
      id: 'when',
      header: 'Received',
      sortValue: (s) => s.receivedAt,
      cell: (s) => (
        <>
          {at(s.receivedAt)}
          <span className="u-caption"> · phone clock {at(s.clientAt)}</span>
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <>
          <StatusPill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatusPill>
          {s.decisionNote ? <span className="u-caption"> · {s.decisionNote}</span> : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (s) =>
        s.status === 'pending' ? (
          <span className="u-row">
            <Button
              variant="tertiary"
              aria-label={`Accept ${describeChange(s.module, s.command)}`}
              disabled={m.accept.isPending}
              onClick={() => {
                setAcceptingId(s.id);
                m.accept.mutate(s.id);
              }}
            >
              Accept
            </Button>
            <Button
              variant="tertiary"
              aria-label={`Reject ${describeChange(s.module, s.command)}`}
              onClick={() => {
                setNote('');
                m.reject.reset();
                setRejecting(s);
              }}
            >
              Reject
            </Button>
          </span>
        ) : s.decidedBy ? (
          `By ${dir.personName(s.decidedBy)}`
        ) : (
          '—'
        ),
    },
  ];

  const pending = list.data?.pendingCount ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Project admin"
        title="Late submissions"
        description={
          pending > 0
            ? `${pending} change${pending === 1 ? '' : 's'} waiting. These were sent from a phone after the sender's access ended. Accepting runs the change as you, under your permissions.`
            : "Changes sent from a phone after the sender's access ended wait here for you to accept or reject."
        }
      />
      <FilterBar label="Filter late submissions">
        <Select
          label="Status"
          value={status}
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v] }))}
          onChange={(e) =>
            setParams({ status: e.target.value === 'pending' ? '' : e.target.value })
          }
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load late submissions" />
      {m.accept.error && acceptingId ? (
        <ErrorAlert error={m.accept.error} title="This change could not be accepted" />
      ) : null}
      {list.isPending ? (
        <SkeletonRows label="Loading late submissions…" />
      ) : (list.data?.items ?? []).length === 0 ? (
        <EmptyState
          icon={LateSubmissionsIcon}
          title={status === 'pending' ? 'Nothing waiting' : `No ${status} changes`}
          description="Changes from people whose access has ended will appear here."
        />
      ) : (
        <DataTable
          caption="Late submissions"
          columns={columns}
          rows={list.data?.items ?? []}
          getRowId={(s) => s.id}
        />
      )}
      {rejecting ? (
        <Dialog
          open
          onClose={() => setRejecting(null)}
          title="Reject this change"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button
                disabled={m.reject.isPending}
                onClick={() =>
                  m.reject.mutate(
                    { id: rejecting.id, note: note.trim() || undefined },
                    { onSuccess: () => setRejecting(null) },
                  )
                }
              >
                {m.reject.isPending ? 'Rejecting…' : 'Reject change'}
              </Button>
            </>
          }
        >
          <div className="stack">
            <p>
              {describeChange(rejecting.module, rejecting.command)}, sent by{' '}
              {dir.personName(rejecting.submittedBy)}. It will never be applied, even if their phone
              sends it again.
            </p>
            <Textarea
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <ErrorAlert error={m.reject.error} title="We couldn't reject this change" />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
