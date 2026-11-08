'use client';

import { useState } from 'react';
import { Button, Checkbox, EmptyState, PageHeader, SkeletonRows } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { AnnouncementDialog } from '../components/AnnouncementDialog';
import { AnnouncementList } from '../components/AnnouncementList';
import { ComposeDialog } from '../components/ComposeDialog';
import {
  isForbidden,
  useAllAnnouncements,
  useCanPostAnnouncements,
} from '../hooks/useAnnouncements';

/** Every announcement sent to you (or by you) on the project, newest first. */
export function AnnouncementsScreen() {
  const project = useCurrentProject();
  usePublishAssistantScope({ projectId: project.projectId });
  const [params] = useUrlState(['item'] as const);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useAllAnnouncements(project.projectId, unreadOnly);
  const canPost = useCanPostAnnouncements(project.projectId);
  const [composing, setComposing] = useState(false);
  // An inbox notification links here with ?item=<id>, which opens that announcement.
  const [openId, setOpenId] = useState<string | null>(params.item || null);
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  return (
    <>
      <PageHeader
        title="Announcements"
        description={unread > 0 ? `${unread} unread` : undefined}
        actions={
          canPost ? (
            <Button onClick={() => setComposing(true)}>
              <Plus size={20} aria-hidden="true" /> New announcement
            </Button>
          ) : null
        }
      />
      <Checkbox
        label="Show unread only"
        checked={unreadOnly}
        onChange={(e) => setUnreadOnly(e.target.checked)}
      />
      {isForbidden(list.error) ? (
        <EmptyState
          title="Announcements aren't available to you"
          description="Your access to this project doesn't include its announcements."
        />
      ) : (
        <ErrorAlert error={list.error} title="We couldn't load the announcements" />
      )}
      {list.isPending ? <SkeletonRows rows={4} label="Loading announcements…" /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Nothing unread' : 'No announcements yet'}
          description={
            unreadOnly
              ? "You're all caught up."
              : canPost
                ? 'Post one to tell the whole project, or a group, about a change.'
                : 'When the project team announces something, it appears here.'
          }
        />
      ) : null}
      {items.length > 0 ? (
        <AnnouncementList items={items} timeZone={project.timezone} onOpen={setOpenId} page />
      ) : null}
      {list.hasNextPage ? (
        <div className="row-actions">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
      <ComposeDialog
        projectId={project.projectId}
        open={composing}
        onClose={() => setComposing(false)}
        onPosted={(id) => {
          setComposing(false);
          setOpenId(id);
        }}
      />
      <AnnouncementDialog
        projectId={project.projectId}
        timeZone={project.timezone}
        announcementId={openId}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
