'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@archova/api-client';
import { linkReasonLabel, type LinkEntityType, type LinkReason } from '@archova/domain';
import { Badge, Button, Card, SkeletonRows } from '@archova/ui';
import { Link2, Plus, X } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useRelatedItems, useRemoveLink } from '../hooks/useRelatedItems';
import { TYPE_LABELS, humanStatus, itemHref } from '../lib/labels';
import { AddRelatedItemDialog } from './AddRelatedItemDialog';

/**
 * "Related items" on a record's page: everything linked to it, from either end, with a way to link another record or
 * remove a link. Drop it on any detail page with that record's type and id. Records the person cannot open are
 * never described, only counted.
 */
export function RelatedItemsPanel({
  type,
  id,
  className,
}: {
  type: LinkEntityType;
  id: string;
  className?: string;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const list = useRelatedItems(project.projectId, type, id);
  const remove = useRemoveLink(project.projectId);
  const [adding, setAdding] = useState(false);

  // A person with no access to related items simply doesn't get the panel.
  if (list.error instanceof ApiError && list.error.status === 403) return null;

  const items = list.data?.data ?? [];
  const hidden = list.data?.hidden ?? 0;
  return (
    <Card
      title="Related items"
      className={className}
      actions={
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={20} aria-hidden="true" /> Link item
        </Button>
      }
    >
      <ErrorAlert error={list.error} title="We couldn't load the related items" />
      <ErrorAlert error={remove.error} title="We couldn't remove that link" />
      {list.isPending ? <SkeletonRows rows={2} label="Loading related items…" /> : null}
      {list.data && items.length === 0 && hidden === 0 ? (
        <p className="u-muted u-m-0">
          Nothing linked yet. Link the RFIs, defects, submittals, letters and documents this depends
          on or led to.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="related-items">
          {items.map((r) => (
            <li key={r.linkId} className="related-items__row">
              <Link2 size={20} className="related-items__icon" aria-hidden="true" />
              <div className="related-items__text">
                <span className="related-items__reason u-caption">
                  {linkReasonLabel(r.reason as LinkReason, r.side)} · {TYPE_LABELS[r.item.type].one}
                </span>
                <Link
                  className="link related-items__title"
                  href={itemHref(org.orgSlug, project.projectId, r.item)}
                >
                  <span className="related-items__ref">{r.item.ref}</span> {r.item.title}
                </Link>
                {r.note ? <span className="u-muted related-items__note">{r.note}</span> : null}
              </div>
              <Badge>{humanStatus(r.item.status)}</Badge>
              <Button
                variant="tertiary"
                aria-label={`Remove link to ${r.item.ref} ${r.item.title}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(r.linkId)}
              >
                <X size={20} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <p className="u-muted u-caption u-m-0">
          {hidden === 1
            ? '1 more linked item is not shown because you do not have access to it.'
            : `${hidden} more linked items are not shown because you do not have access to them.`}
        </p>
      ) : null}
      <AddRelatedItemDialog
        projectId={project.projectId}
        from={{ type, id }}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </Card>
  );
}
