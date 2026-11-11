'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { WarrantyClaim } from '../data/api';
import { useWarrantyItem, useWarrantyMutations } from '../hooks/useWarranty';
import {
  RESPONSIBLE_LABELS,
  STATE_LABELS,
  STATE_TONE,
  SYSTEM_LABELS,
  useCanManageWarranty,
} from './WarrantyScreen';

const STATUS_LABELS: Record<WarrantyClaim['status'], string> = {
  draft: 'Draft',
  open: 'Open',
  ready_for_review: 'Ready for inspection',
  closed: 'Closed',
  disputed: 'Disputed',
  void: 'Void',
};

/** One warranty item: its terms, who answers for it, and every claim made against it. */
export function WarrantyItemScreen({ itemId }: { itemId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  const { canManage } = useCanManageWarranty();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'warranty', id: itemId },
  });
  const detail = useWarrantyItem(project.projectId, itemId);
  const m = useWarrantyMutations(project.projectId);
  const directory = useProjectDirectory();
  if (detail.isPending) return <SkeletonRows label="Loading warranty item…" />;
  if (!detail.data)
    return <ErrorAlert error={detail.error} title="We couldn't load this warranty item" />;
  const { item, claims } = detail.data;
  const who = item.responsibleCompanyId
    ? directory.companyName(item.responsibleCompanyId)
    : (item.responsibleName ?? RESPONSIBLE_LABELS[item.responsibleType]);

  const columns: DataTableColumn<WarrantyClaim>[] = [
    {
      id: 'claim',
      header: 'Claim',
      rowHeader: true,
      cell: (c) => (
        <Link className="link" href={webRoutes.defect(org.orgSlug, project.projectId, c.defectId)}>
          {c.numberLabel} {c.title}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => (
        <StatusPill tone={c.status === 'closed' ? 'success' : c.isOverdue ? 'danger' : 'info'}>
          {c.isOverdue ? 'Overdue' : STATUS_LABELS[c.status]}
        </StatusPill>
      ),
    },
    {
      id: 'by',
      header: 'Answerable',
      cell: (c) => (c.assigneeCompanyId ? directory.companyName(c.assigneeCompanyId) : '—'),
    },
    {
      id: 'raised',
      header: 'Raised',
      sortValue: (c) => c.raisedAt,
      cell: (c) => formatLocalDate(c.raisedAt.slice(0, 10)),
    },
    { id: 'days', header: 'Days open', align: 'end', cell: (c) => String(c.daysOpen) },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.warranty(org.orgSlug, project.projectId)}>
            Warranty
          </Link>
        }
        title={`${item.numberLabel} ${item.name}`}
        description={`${SYSTEM_LABELS[item.system]} · answerable: ${RESPONSIBLE_LABELS[item.responsibleType]} (${who})`}
      />
      <Card title="Warranty period">
        <p>
          {formatLocalDate(item.startDate)} to {formatLocalDate(item.expiryDate)} (
          {item.durationMonths} months){' '}
          <StatusPill tone={STATE_TONE[item.state]}>{STATE_LABELS[item.state]}</StatusPill>
        </p>
        <p className="u-muted">
          {item.daysToExpiry >= 0
            ? `${item.daysToExpiry} days left.`
            : `Ended ${-item.daysToExpiry} days ago.`}
        </p>
        {item.description ? <p>{item.description}</p> : null}
        <div className="row-actions">
          <Link
            className="btn btn-primary"
            href={`${webRoutes.newDefect(org.orgSlug, project.projectId)}?warrantyItemId=${encodeURIComponent(item.id)}`}
          >
            Raise a claim
          </Link>
          {canManage ? (
            <Button
              variant="secondary"
              disabled={m.remove.isPending}
              onClick={() =>
                m.remove.mutate(
                  { itemId: item.id, version: item.version },
                  {
                    onSuccess: () =>
                      router.push(webRoutes.warranty(org.orgSlug, project.projectId)),
                  },
                )
              }
            >
              Remove from register
            </Button>
          ) : null}
        </div>
        <ErrorAlert error={m.remove.error} title="We couldn't remove this item" />
      </Card>
      <DataTable
        caption="Claim history"
        columns={columns}
        rows={claims}
        getRowId={(c) => c.defectId}
        empty={
          <EmptyState title="No claims" description="Nothing has been claimed against this item." />
        }
      />
    </div>
  );
}
