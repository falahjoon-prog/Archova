'use client';

import { Button } from '@archova/ui';
import { Bookmark, BookmarkCheck } from '@archova/ui/icons';
import type { BookmarkEntityType } from '../data/api';
import { useBookmarks, useRemoveBookmark, useSaveBookmark } from '../hooks/useBookmarks';

/**
 * Saves or removes the record on the person's Bookmarks list. `title` and `subtitle` are what the list shows, so
 * pass what the person sees on the screen (for example "RFI-012 Slab edge" and "Open"). Hidden if the list can't load.
 */
export function BookmarkButton({
  entityType,
  entityId,
  projectId,
  title,
  subtitle,
}: {
  entityType: BookmarkEntityType;
  entityId: string;
  projectId: string;
  title: string;
  subtitle?: string;
}) {
  const list = useBookmarks();
  const save = useSaveBookmark();
  const remove = useRemoveBookmark();
  if (list.isError) return null;
  const saved = list.data?.find((b) => b.entityType === entityType && b.entityId === entityId);
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <Button
      variant="tertiary"
      aria-pressed={Boolean(saved)}
      loading={list.isPending || save.isPending || remove.isPending}
      onClick={() =>
        saved
          ? remove.mutate(saved.id)
          : save.mutate({
              entityType,
              entityId,
              projectId,
              title: title.slice(0, 200),
              ...(subtitle ? { subtitle: subtitle.slice(0, 200) } : {}),
            })
      }
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" /> {saved ? 'Bookmarked' : 'Bookmark'}
    </Button>
  );
}
