'use client';

import { useState } from 'react';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { AlertTriangle, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { RiskDialog } from '../components/RiskDialog';
import type { ProjectRisk } from '../data/api';
import { useRiskMutations, useRiskSummary, useRisks } from '../hooks/useRisks';
import { CATEGORY_LABELS, LEVEL_LABELS, LEVEL_TONES, STATUS_LABELS, ragLabel } from '../lib/labels';

/** The project risk register. Its summary is what the project health model reads for the risk colour. */
export function RisksScreen() {
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'risks', id: 'list' },
  });
  const risks = useRisks();
  const summary = useRiskSummary();
  const { remove } = useRiskMutations();
  const [editing, setEditing] = useState<ProjectRisk | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = risks.data ?? [];

  const columns: DataTableColumn<ProjectRisk>[] = [
    { id: 'no', header: 'No.', sortValue: (r) => r.number, cell: (r) => `R-${r.number}` },
    {
      id: 'title',
      header: 'Risk',
      rowHeader: true,
      sortValue: (r) => r.title,
      cell: (r) => (
        <button type="button" className="link" onClick={() => setEditing(r)}>
          {r.title}
        </button>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      sortValue: (r) => r.category,
      cell: (r) => CATEGORY_LABELS[r.category],
    },
    {
      id: 'score',
      header: 'Score',
      align: 'end',
      sortValue: (r) => r.score,
      cell: (r) => (
        <StatusPill tone={LEVEL_TONES[r.level]}>
          {LEVEL_LABELS[r.level]} {r.score}
        </StatusPill>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      cell: (r) => STATUS_LABELS[r.status],
    },
    {
      id: 'owner',
      header: 'Owner',
      sortValue: (r) => r.ownerName ?? '',
      cell: (r) => r.ownerName ?? '—',
    },
    {
      id: 'review',
      header: 'Review by',
      sortValue: (r) => r.reviewDate ?? '',
      cell: (r) => (r.reviewDate ? formatLocalDate(r.reviewDate) : '—'),
    },
    {
      id: 'remove',
      header: <span className="u-visually-hidden">Remove</span>,
      cell: (r) => (
        <Button
          variant="tertiary"
          loading={remove.isPending && remove.variables === r.id}
          onClick={() => remove.mutate(r.id)}
        >
          Remove
        </Button>
      ),
    },
  ];

  const rag = summary.data ? ragLabel(summary.data.rag) : null;

  return (
    <div className="stack-lg">
      <PageHeader
        title="Risk register"
        description="What could go wrong on this project, how likely and how bad. It sets the risk colour on the project health summary."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Add risk
          </Button>
        }
      />
      <ErrorAlert error={risks.error ?? remove.error} title="We couldn't load the risk register" />
      {summary.data && rag ? (
        <>
          <p>
            <StatusPill tone={rag.tone}>{rag.label}</StatusPill>
          </p>
          <StatGrid
            items={[
              { label: 'Live risks', value: summary.data.open },
              {
                label: 'High',
                value: summary.data.high,
                tone: summary.data.high > 0 ? 'danger' : 'neutral',
              },
              {
                label: 'Medium',
                value: summary.data.medium,
                tone: summary.data.medium > 0 ? 'warning' : 'neutral',
              },
              { label: 'Low', value: summary.data.low },
              {
                label: 'Reviews overdue',
                value: summary.data.overdueReviews,
                tone: summary.data.overdueReviews > 0 ? 'warning' : 'neutral',
              },
            ]}
          />
        </>
      ) : null}
      {risks.isPending ? (
        <SkeletonRows rows={4} />
      ) : (
        <DataTable
          caption="Project risks"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          defaultSort={{ columnId: 'score', direction: 'desc' }}
          empty={
            <EmptyState
              icon={AlertTriangle}
              title="No risks recorded yet"
              description="Add the first risk. Until you do, the project's risk colour shows as not assessed."
              action={<Button onClick={() => setAdding(true)}>Add risk</Button>}
            />
          }
        />
      )}
      {adding ? <RiskDialog open onClose={() => setAdding(false)} risk={null} /> : null}
      {editing ? <RiskDialog open onClose={() => setEditing(null)} risk={editing} /> : null}
    </div>
  );
}
