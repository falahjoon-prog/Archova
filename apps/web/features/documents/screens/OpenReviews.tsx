'use client';

import { useState } from 'react';
import type { OpenDocumentReview } from '@archova/contracts';
import {
  Button,
  DataTable,
  EmptyState,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { DocumentsIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { useOpenReviews } from '../hooks/useReviews';
import { LateBadge } from './ReviewPanel';

/** Every document out for review, soonest due first. Filter to what is waiting on you, or what is late. */
export function OpenReviews({ onOpen }: { onOpen: (documentId: string) => void }) {
  const project = useCurrentProject();
  const actor = useActor();
  const [filter, setFilter] = useState<'all' | 'mine' | 'late'>('all');
  const reviews = useOpenReviews(project.projectId, true, false);
  const rows = (reviews.data ?? []).filter((r) =>
    filter === 'late'
      ? r.review.overdueDays > 0
      : filter === 'mine'
        ? r.review.steps.some((s) => s.userId === actor.id && s.status === 'pending')
        : true,
  );
  const columns: DataTableColumn<OpenDocumentReview>[] = [
    {
      id: 'title',
      header: 'Document',
      rowHeader: true,
      sortValue: (r) => r.documentTitle,
      cell: (r) => (
        <button type="button" className="link-button" onClick={() => onOpen(r.documentId)}>
          {r.documentTitle}
        </button>
      ),
    },
    {
      id: 'number',
      header: 'Number',
      cell: (r) => <span className="u-mono">{r.docNumber ?? '—'}</span>,
    },
    {
      id: 'waiting',
      header: 'Waiting on',
      cell: (r) =>
        r.review.steps
          .filter((s) => s.status === 'pending')
          .map((s) => (s.userId === actor.id ? 'You' : (s.userName ?? 'Project member')))
          .join(', ') || '—',
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (r) => r.review.dueAt,
      cell: (r) => (
        <span>
          {r.review.dueAt ? formatInstant(r.review.dueAt, project.timezone) : 'No date'}{' '}
          <LateBadge days={r.review.overdueDays} />
          {r.review.stale ? <StatusPill tone="warning">Newer revision</StatusPill> : null}
        </span>
      ),
    },
  ];
  if (reviews.isPending) return <SkeletonRows label="Loading reviews…" />;
  return (
    <div className="stack">
      <ErrorAlert error={reviews.error} title="We couldn't load reviews" />
      <div className="row-actions">
        {(['all', 'mine', 'late'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'secondary'}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'mine' ? 'Waiting on me' : 'Late'}
          </Button>
        ))}
      </div>
      <DataTable
        caption="Documents out for review"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.documentId}
        empty={
          <EmptyState
            icon={DocumentsIcon}
            title="Nothing is out for review"
            description="Open a document and choose Send for review to start a round."
          />
        }
      />
    </div>
  );
}
