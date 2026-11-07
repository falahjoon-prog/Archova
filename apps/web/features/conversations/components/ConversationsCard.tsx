'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, SkeletonRows } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { webRoutes } from '@archova/routes';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { isForbidden, useConversations } from '../hooks/useConversations';
import { initialsOf, relativeAge } from '../lib/time';
import { NewConversationDialog, ThreadDialog } from './ConversationDialogs';

/** Project home: the team's latest conversations, with a way to start one or open one and reply. */
export function ConversationsCard({
  projectId,
  timeZone,
}: {
  projectId: string;
  timeZone: string;
}) {
  const org = useCurrentOrg();
  const list = useConversations(projectId);
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Outside users are not part of the team chat: show nothing rather than an error they cannot act on.
  if (isForbidden(list.error)) return null;

  const threads = list.data?.data ?? [];
  return (
    <Card
      title="Conversations"
      className="conversations"
      actions={
        <Button variant="secondary" onClick={() => setStarting(true)}>
          <Plus size={20} aria-hidden="true" /> New conversation
        </Button>
      }
    >
      <ErrorAlert error={list.error} title="We couldn't load the conversations" />
      {list.isPending ? <SkeletonRows rows={2} label="Loading conversations…" /> : null}
      {list.data && threads.length === 0 ? (
        <p className="u-muted">
          No conversations yet. Start one to ask the team a question or share an update.
        </p>
      ) : null}
      {threads.length > 0 ? (
        <ul className="conversations__list">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="conversations__item"
                onClick={() => setOpenId(t.id)}
                aria-label={`Open conversation: ${t.subject}`}
              >
                <span className="conversations__avatar" aria-hidden="true">
                  {initialsOf(t.lastMessage.authorName)}
                </span>
                <span className="conversations__text">
                  <span className="conversations__who">{t.lastMessage.authorName}</span>
                  <span className="conversations__subject">{t.subject}</span>
                  <span className="conversations__preview">{t.lastMessage.body}</span>
                  <time className="u-caption" dateTime={t.lastMessageAt}>
                    {relativeAge(t.lastMessageAt, timeZone)}
                    {t.messageCount > 1 ? ` · ${t.messageCount} messages` : ''}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {threads.length > 0 ? (
        <p className="conversations__all">
          <Link className="link" href={webRoutes.conversations(org.orgSlug, projectId)}>
            See all conversations
          </Link>
        </p>
      ) : null}
      <NewConversationDialog
        projectId={projectId}
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(id) => {
          setStarting(false);
          setOpenId(id);
        }}
      />
      <ThreadDialog
        projectId={projectId}
        timeZone={timeZone}
        conversationId={openId}
        onClose={() => setOpenId(null)}
      />
    </Card>
  );
}
