'use client';

import { useState } from 'react';
import { Button, EmptyState, PageHeader, SkeletonRows } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { NewConversationDialog, ThreadDialog } from '../components/ConversationDialogs';
import { isForbidden, useAllConversations } from '../hooks/useConversations';
import { initialsOf, relativeAge } from '../lib/time';

/** Every conversation on the project, most recent activity first. Team only; outside users see a plain notice. */
export function ConversationsScreen() {
  const project = useCurrentProject();
  usePublishAssistantScope({ projectId: project.projectId });
  const list = useAllConversations(project.projectId);
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const threads = list.data?.pages.flatMap((p) => p.data) ?? [];
  const timeZone = project.timezone;

  return (
    <>
      <PageHeader
        title="Conversations"
        actions={
          <Button onClick={() => setStarting(true)}>
            <Plus size={20} aria-hidden="true" /> New conversation
          </Button>
        }
      />
      {isForbidden(list.error) ? (
        <EmptyState
          title="Conversations are for the project team"
          description="Your access to this project doesn't include the team's conversations."
        />
      ) : (
        <ErrorAlert error={list.error} title="We couldn't load the conversations" />
      )}
      {list.isPending ? <SkeletonRows rows={4} label="Loading conversations…" /> : null}
      {list.data && threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Start one to ask the team a question or share an update."
        />
      ) : null}
      {threads.length > 0 ? (
        <ul className="conversations__list conversations__list--page">
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
                  <span className="conversations__who">{t.subject}</span>
                  <span className="conversations__subject">
                    Started by {t.createdByName} · {t.messageCount}{' '}
                    {t.messageCount === 1 ? 'message' : 'messages'}
                  </span>
                  <span className="conversations__preview">
                    {t.lastMessage.authorName}: {t.lastMessage.body}
                  </span>
                  <time className="u-caption" dateTime={t.lastMessageAt}>
                    {relativeAge(t.lastMessageAt, timeZone)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
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
      <NewConversationDialog
        projectId={project.projectId}
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(id) => {
          setStarting(false);
          setOpenId(id);
        }}
      />
      <ThreadDialog
        projectId={project.projectId}
        timeZone={timeZone}
        conversationId={openId}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
