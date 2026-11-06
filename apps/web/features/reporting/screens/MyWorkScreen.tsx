'use client';

import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { Bookmark, Calendar, Trash2 } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useMyWork, useRemoveBookmark } from '../hooks/useReporting';
import { SOURCE_LABELS, type MyWorkItem } from '../lib/types';

const BUCKET_LABELS = { overdue: 'Overdue', today: 'Due today', next7: 'Next 7 days' } as const;
const BUCKET_TONES = { overdue: 'danger', today: 'warning', next7: 'info' } as const;

/** Everything you have to chase across your projects: what is due, what was raised lately, and your bookmarks. */
export function MyWorkScreen() {
  const org = useCurrentOrg();
  const work = useMyWork();
  const remove = useRemoveBookmark();
  const data = work.data;

  const columns = (dateHeader: string): DataTableColumn<MyWorkItem>[] => [
    {
      id: 'item',
      header: 'Item',
      rowHeader: true,
      sortValue: (r) => r.ref,
      cell: (r) => (
        <>
          {r.ref} <span className="u-muted">{SOURCE_LABELS[r.source]}</span>
          <div>{r.title}</div>
        </>
      ),
    },
    {
      id: 'project',
      header: 'Project',
      sortValue: (r) => r.project,
      cell: (r) => (
        <Link className="link" href={webRoutes.project(org.orgSlug, r.projectId)}>
          {r.project}
        </Link>
      ),
    },
    {
      id: 'date',
      header: dateHeader,
      sortValue: (r) => (dateHeader === 'Due' ? (r.dueDate ?? '') : r.createdAt),
      cell: (r) =>
        dateHeader === 'Due' ? (
          <>
            {r.dueDate ? formatLocalDate(r.dueDate) : '—'}{' '}
            {r.bucket ? (
              <StatusPill tone={BUCKET_TONES[r.bucket]}>{BUCKET_LABELS[r.bucket]}</StatusPill>
            ) : null}
          </>
        ) : (
          formatLocalDate(r.createdAt.slice(0, 10))
        ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="My Work"
        description="Open RFIs, defects and submittals due across every project you can open. Only what you are allowed to see on each project is shown."
      />
      <ErrorAlert error={work.error ?? remove.error} title="We couldn't load My Work" />
      {data ? (
        <StatGrid
          items={[
            {
              label: BUCKET_LABELS.overdue,
              value: data.counts.overdue,
              tone: data.counts.overdue > 0 ? 'danger' : undefined,
            },
            { label: BUCKET_LABELS.today, value: data.counts.today },
            { label: BUCKET_LABELS.next7, value: data.counts.next7 },
          ]}
        />
      ) : null}
      {data?.restrictedProjects ? (
        <Alert tone="info" title="Some projects are partly hidden">
          On {data.restrictedProjects} {data.restrictedProjects === 1 ? 'project' : 'projects'} you
          cannot open every tool, so those items are not listed.
        </Alert>
      ) : null}
      {data?.truncated ? (
        <Alert tone="info" title="Showing the most urgent items">
          Close out finished items to bring the rest into view.
        </Alert>
      ) : null}
      {work.isPending ? (
        <SkeletonRows label="Loading your work…" />
      ) : (
        <>
          <Card title="Due soon">
            <DataTable
              caption="Open items that are overdue or due in the next 7 days"
              columns={columns('Due')}
              rows={data?.items ?? []}
              getRowId={(r) => `${r.source}:${r.projectId}:${r.ref}`}
              empty={
                <EmptyState
                  icon={Calendar}
                  title="Nothing due"
                  description="Open items that are overdue or due this week appear here."
                />
              }
            />
          </Card>
          <Card title="Recently raised">
            <DataTable
              caption="Open items raised in the last 14 days"
              columns={columns('Raised')}
              rows={data?.recent ?? []}
              getRowId={(r) => `${r.source}:${r.projectId}:${r.ref}`}
              empty={
                <EmptyState
                  icon={Calendar}
                  title="Nothing new"
                  description="Items raised in the last 14 days appear here."
                />
              }
            />
          </Card>
          <Card title="Bookmarks">
            {data?.bookmarks.length ? (
              <ul className="stack-sm" aria-label="Your bookmarks">
                {data.bookmarks.map((b) => (
                  <li key={b.id} className="row-actions">
                    <Link className="link" href={b.path}>
                      {b.label}
                    </Link>
                    <Button
                      variant="secondary"
                      aria-label={`Remove bookmark ${b.label}`}
                      loading={remove.isPending && remove.variables === b.id}
                      onClick={() => remove.mutate(b.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Bookmark}
                title="No bookmarks yet"
                description="Use “Bookmark this page” on the Portfolio page to keep a page here."
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
