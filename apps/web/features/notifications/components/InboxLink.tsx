'use client';

import Link from 'next/link';
import { Bell } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useInbox } from '../hooks/useNotifications';

/** The bell in the top bar: a link to the inbox with the unread count. Quiet when the inbox can't load. */
export function InboxLink() {
  const { orgSlug } = useCurrentOrg();
  const inbox = useInbox();
  const unread = inbox.data?.unreadCount ?? 0;
  const label = unread > 0 ? `Inbox, ${unread} unread` : 'Inbox';
  return (
    <Link className="inbox-link ac-focusable" href={webRoutes.inbox(orgSlug)} aria-label={label}>
      <Bell size={20} strokeWidth={1.5} aria-hidden="true" />
      {unread > 0 ? (
        <span className="inbox-link__count" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
