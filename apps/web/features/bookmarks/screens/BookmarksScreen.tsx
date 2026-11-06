'use client';

import Link from 'next/link';
import { Button, EmptyState, PageHeader, SkeletonRows, StatusPill } from '@archova/ui';
import { Bookmark as BookmarkIcon, X } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { Bookmark } from '../data/api';
import { useBookmarks, useRemoveBookmark } from '../hooks/useBookmarks';

const LABEL: Record<Bookmark['entityType'], string> = {
  rfi: 'RFI',
  submittal: 'Submittal',
  defect: 'Defect',
  drawing_sheet: 'Drawing',
  meeting: 'Meeting',
};

function target(orgSlug: string, b: Bookmark): string {
  switch (b.entityType) {
    case 'rfi':
      return webRoutes.rfi(orgSlug, b.projectId, b.entityId);
    case 'submittal':
      return webRoutes.submittal(orgSlug, b.projectId, b.entityId);
    case 'defect':
      return webRoutes.defect(orgSlug, b.projectId, b.entityId);
    case 'drawing_sheet':
      return webRoutes.drawing(orgSlug, b.projectId, b.entityId);
    case 'meeting':
      return webRoutes.meeting(orgSlug, b.projectId, b.entityId);
  }
}

/** The person's saved shortcuts to RFIs, drawings, submittals and other records, newest first. */
export function BookmarksScreen() {
  const { orgSlug } = useCurrentOrg();
  const list = useBookmarks();
  const remove = useRemoveBookmark();

  return (
    <div className="stack">
      <PageHeader
        title="Bookmarks"
        description="Records you saved for quick access. Only you can see this list."
      />
      {list.isPending ? (
        <SkeletonRows rows={4} />
      ) : list.isError ? (
        <ErrorAlert error={list.error} title="We couldn't load your bookmarks" />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={BookmarkIcon}
          title="No bookmarks yet"
          description="Use the Bookmark button on an RFI, submittal, defect, drawing or meeting to keep it here."
        />
      ) : (
        <ul className="inbox-list">
          {list.data.map((b) => (
            <li key={b.id} className="inbox-list__item">
              <div className="inbox-list__main">
                <p className="inbox-list__title">
                  <Link className="link" href={target(orgSlug, b)}>
                    {b.title}
                  </Link>
                </p>
                {b.subtitle ? <p className="inbox-list__body">{b.subtitle}</p> : null}
              </div>
              <div className="inbox-list__side">
                <StatusPill tone="neutral">{LABEL[b.entityType]}</StatusPill>
                <Button
                  variant="tertiary"
                  size="sm"
                  iconOnly
                  aria-label={`Remove bookmark ${b.title}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(b.id)}
                >
                  <X size={16} strokeWidth={1.5} aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
