'use client';

import Link from 'next/link';
import { Button, Card, EmptyState, SkeletonRows, StatusPill } from '@archova/ui';
import { Bookmark as BookmarkIcon, X } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useBookmarks, useRemoveBookmark } from '../hooks/useBookmarks';
import { bookmarkLabel, bookmarkTarget } from '../lib/target';

const SHOWN = 6;

/** The person's own bookmarks, newest first: on one project's home, or across every project when no project is given. */
export function BookmarksCard({ projectId }: { projectId?: string }) {
  const { orgSlug } = useCurrentOrg();
  const list = useBookmarks(projectId);
  const remove = useRemoveBookmark();
  const items = list.data?.slice(0, SHOWN) ?? [];
  const more = (list.data?.length ?? 0) - items.length;

  return (
    <Card title="Bookmarks">
      {list.isPending ? (
        <SkeletonRows rows={3} />
      ) : list.isError ? (
        <ErrorAlert error={list.error} title="We couldn't load your bookmarks" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookmarkIcon}
          title="No bookmarks yet"
          description="Use the Bookmark button on an RFI, submittal, defect, drawing or meeting to keep it here."
        />
      ) : (
        <>
          <ul className="inbox-list">
            {items.map((b) => (
              <li key={b.id} className="inbox-list__item">
                <div className="inbox-list__main">
                  <p className="inbox-list__title">
                    <Link className="link" href={bookmarkTarget(orgSlug, b)}>
                      {b.title}
                    </Link>
                  </p>
                  {b.subtitle ? <p className="inbox-list__body">{b.subtitle}</p> : null}
                </div>
                <div className="inbox-list__side">
                  <StatusPill tone="neutral">{bookmarkLabel[b.entityType]}</StatusPill>
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
          {more > 0 ? <p className="u-muted">and {more} more on this project</p> : null}
        </>
      )}
    </Card>
  );
}
