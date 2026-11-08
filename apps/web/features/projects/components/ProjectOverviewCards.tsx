'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { webRoutes } from '@archova/routes';
import { localDateOf } from '@archova/time';
import { Card, SkeletonRows, StatusPill } from '@archova/ui';
import { useDefectList, formatDefectNumber } from '@/features/defects';
import { useRfiList, formatRfiNumber } from '@/features/rfis';
import { formatLocalDate } from '@/shared/lib/format';
import { bucketOpenItems, type OverviewItem } from '../lib/overview';

/**
 * Open RFIs and defects for the project, as overview items. A tool the caller cannot read, or that fails to load,
 * simply contributes nothing; the overview never blocks on it.
 */
function useOpenItems(orgSlug: string, projectId: string) {
  const rfis = useRfiList(projectId, { status: 'open' });
  const defects = useDefectList({ status: 'open' });
  const items = useMemo<OverviewItem[]>(
    () => [
      ...(rfis.data ?? []).map((r) => ({
        key: `rfi-${r.id}`,
        kind: 'RFI' as const,
        ref: formatRfiNumber(r.number),
        title: r.subject,
        dueDate: r.dueDate,
        href: webRoutes.rfi(orgSlug, projectId, r.id),
      })),
      ...(defects.data ?? []).map((d) => ({
        key: `def-${d.id}`,
        kind: 'Defect' as const,
        ref: formatDefectNumber(d.number),
        title: d.title,
        dueDate: d.dueDate,
        href: webRoutes.defect(orgSlug, projectId, d.id),
      })),
    ],
    [rfis.data, defects.data, orgSlug, projectId],
  );
  return { items, pending: rfis.isPending && defects.isPending };
}

function ItemLink({ item }: { item: OverviewItem }) {
  return (
    <li className="overview-item">
      <span className="overview-item__kind u-caption">
        {item.kind} · {item.ref}
      </span>
      <Link className="link overview-item__title" href={item.href}>
        {item.title}
      </Link>
      {item.dueDate ? <span className="u-caption">Due {formatLocalDate(item.dueDate)}</span> : null}
    </li>
  );
}

/** Overdue, due today and due in the next 7 days across open RFIs and defects (project overview). */
export function OpenItemsCard({
  orgSlug,
  projectId,
  timeZone,
}: {
  orgSlug: string;
  projectId: string;
  timeZone: string;
}) {
  const { items, pending } = useOpenItems(orgSlug, projectId);
  const buckets = useMemo(
    () => bucketOpenItems(items, localDateOf(new Date(), timeZone)),
    [items, timeZone],
  );
  const rows = [
    { id: 'overdue', label: 'Overdue', tone: 'overdue', count: buckets.overdue.length },
    { id: 'today', label: 'Due today', tone: 'today', count: buckets.today.length },
    { id: 'next7', label: 'Next 7 days', tone: 'next', count: buckets.next7.length },
  ] as const;

  return (
    <Card title="Open items">
      {pending ? (
        <SkeletonRows rows={3} label="Loading open items…" />
      ) : (
        <>
          <p className="u-caption overview-hint">Open RFIs and defects, by due date.</p>
          <ul className="overview-rows">
            {rows.map((r) => (
              <li key={r.id} className="overview-row">
                <span
                  className={`overview-row__dot overview-row__dot--${r.tone}`}
                  aria-hidden="true"
                />
                <span className="overview-row__label">{r.label}</span>
                <span className="overview-row__count">{r.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** The most overdue items first, so the card answers "what needs me now". Hidden when nothing is overdue. */
export function NeedsAttentionCard({
  orgSlug,
  projectId,
  timeZone,
}: {
  orgSlug: string;
  projectId: string;
  timeZone: string;
}) {
  const { items, pending } = useOpenItems(orgSlug, projectId);
  const buckets = useMemo(
    () => bucketOpenItems(items, localDateOf(new Date(), timeZone)),
    [items, timeZone],
  );
  if (pending) return null;
  return (
    <Card
      title="Needs attention"
      actions={
        <StatusPill tone={buckets.overdue.length ? 'danger' : 'success'}>
          {buckets.overdue.length ? `${buckets.overdue.length} overdue` : 'Nothing overdue'}
        </StatusPill>
      }
    >
      {buckets.overdue.length === 0 ? (
        <p className="u-muted">No open RFIs or defects are past their due date.</p>
      ) : (
        <ul className="overview-list">
          {buckets.overdue.slice(0, 5).map((item) => (
            <ItemLink key={item.key} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}
