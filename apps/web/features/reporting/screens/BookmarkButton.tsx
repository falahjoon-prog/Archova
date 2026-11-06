'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@archova/ui';
import { Bookmark } from '@archova/ui/icons';
import { useAddBookmark } from '../hooks/useReporting';

/** Saves the page the person is on to their My Work bookmarks. */
export function BookmarkButton({ label, projectId }: { label: string; projectId?: string }) {
  const path = usePathname();
  const add = useAddBookmark();
  const [saved, setSaved] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={add.isPending}
      disabled={saved}
      onClick={() =>
        add.mutate(
          { label, path, ...(projectId ? { projectId } : {}) },
          { onSuccess: () => setSaved(true) },
        )
      }
    >
      <Bookmark size={16} aria-hidden="true" /> {saved ? 'Bookmarked' : 'Bookmark this page'}
    </Button>
  );
}
