'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, SkeletonRows } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { isForbidden, useAnnouncements, useCanPostAnnouncements } from '../hooks/useAnnouncements';
import { AnnouncementDialog } from './AnnouncementDialog';
import { AnnouncementList } from './AnnouncementList';
import { ComposeDialog } from './ComposeDialog';

/** Project home: the latest announcements sent to you, with a way to post one if you can. */
export function AnnouncementsCard({
  projectId,
  timeZone,
}: {
  projectId: string;
  timeZone: string;
}) {
  const org = useCurrentOrg();
  const list = useAnnouncements(projectId);
  const canPost = useCanPostAnnouncements(projectId);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Someone with no access to the project's announcements sees nothing rather than an error they cannot act on.
  if (isForbidden(list.error)) return null;
  // Nothing sent to you and nothing you can post: no point taking up space on Project home.
  if (list.data && list.data.data.length === 0 && !canPost) return null;

  const items = list.data?.data ?? [];
  const unread = list.data?.unreadCount ?? 0;
  return (
    <Card
      title={
        <>Announcements {unread > 0 ? <Badge label={`${unread} unread`}>{unread}</Badge> : null}</>
      }
      className="announcements"
      actions={
        canPost ? (
          <Button variant="secondary" onClick={() => setComposing(true)}>
            <Plus size={20} aria-hidden="true" /> New announcement
          </Button>
        ) : undefined
      }
    >
      <ErrorAlert error={list.error} title="We couldn't load the announcements" />
      {list.isPending ? <SkeletonRows rows={2} label="Loading announcements…" /> : null}
      {list.data && items.length === 0 ? (
        <p className="u-muted">
          No announcements yet. Post one to tell the whole project, or a group, about a change.
        </p>
      ) : null}
      {items.length > 0 ? (
        <AnnouncementList items={items} timeZone={timeZone} onOpen={setOpenId} />
      ) : null}
      {items.length > 0 ? (
        <p className="announcements__all">
          <Link className="link" href={webRoutes.announcements(org.orgSlug, projectId)}>
            See all announcements
          </Link>
        </p>
      ) : null}
      <ComposeDialog
        projectId={projectId}
        open={composing}
        onClose={() => setComposing(false)}
        onPosted={(id) => {
          setComposing(false);
          setOpenId(id);
        }}
      />
      <AnnouncementDialog
        projectId={projectId}
        timeZone={timeZone}
        announcementId={openId}
        onClose={() => setOpenId(null)}
      />
    </Card>
  );
}
