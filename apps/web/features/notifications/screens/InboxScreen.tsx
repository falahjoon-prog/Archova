'use client';

import Link from 'next/link';
import { Button, EmptyState, PageHeader, SkeletonRows, StatusPill } from '@archova/ui';
import { Bell } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { Notification } from '../data/api';
import { useInbox, useMarkAllRead, useMarkRead } from '../hooks/useNotifications';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Where a notification leads: a meeting, or a tender package. */
function target(orgSlug: string, n: Notification): string | null {
  if (!n.projectId) return null;
  if (n.entityType === 'meeting') return webRoutes.meeting(orgSlug, n.projectId, n.entityId);
  if (n.entityType === 'tender_package')
    return webRoutes.tenderPackage(orgSlug, n.projectId, n.entityId);
  if (n.entityType === 'contract') return webRoutes.contract(orgSlug, n.projectId, n.entityId);
  return null;
}

/** The person's inbox: reminders and notices addressed to them, newest first (product/07 MTG-AC3). */
export function InboxScreen() {
  const { orgSlug } = useCurrentOrg();
  const inbox = useInbox();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  return (
    <div className="stack">
      <PageHeader
        title="Inbox"
        description="Reminders and notices for you."
        actions={
          (inbox.data?.unreadCount ?? 0) > 0 ? (
            <Button
              variant="secondary"
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all as read
            </Button>
          ) : null
        }
      />
      {inbox.isPending ? (
        <SkeletonRows rows={4} />
      ) : inbox.isError ? (
        <ErrorAlert error={inbox.error} title="We couldn't load your inbox" />
      ) : inbox.data.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing here yet"
          description="When an action of yours is due or overdue, you'll be reminded here."
        />
      ) : (
        <ul className="inbox-list">
          {inbox.data.data.map((n) => {
            const href = target(orgSlug, n);
            const unread = n.readAt === null;
            return (
              <li key={n.id} className="inbox-list__item" data-unread={unread || undefined}>
                <div className="inbox-list__main">
                  <p className="inbox-list__title">
                    {href ? (
                      <Link
                        className="link"
                        href={href}
                        onClick={() => unread && markRead.mutate(n.id)}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </p>
                  {n.body ? <p className="inbox-list__body">{n.body}</p> : null}
                  <p className="inbox-list__when">{formatInstant(n.createdAt, tz())}</p>
                </div>
                {unread ? (
                  <div className="inbox-list__side">
                    <StatusPill tone="info">New</StatusPill>
                    <Button variant="tertiary" size="sm" onClick={() => markRead.mutate(n.id)}>
                      Mark read
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
