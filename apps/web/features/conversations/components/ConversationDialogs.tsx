'use client';

import { useState, type FormEvent } from 'react';
import { Button, Dialog, SkeletonRows, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useConversation, usePostMessage, useStartConversation } from '../hooks/useConversations';
import { initialsOf, relativeAge } from '../lib/time';

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

export function NewConversationDialog({
  projectId,
  open,
  onClose,
  onStarted,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const start = useStartConversation(projectId);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const ready = subject.trim().length > 0 && body.trim().length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    start.mutate(
      { subject: subject.trim(), body: body.trim() },
      {
        onSuccess: (created) => {
          setSubject('');
          setBody('');
          onStarted(created.id);
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="New conversation">
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={start.error} title="We couldn't start the conversation" />
        <TextField
          label="Subject"
          value={subject}
          maxLength={SUBJECT_MAX}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
        <Textarea
          label="Message"
          value={body}
          maxLength={BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          required
        />
        <div className="row-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready} loading={start.isPending}>
            Start conversation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ThreadDialog({
  projectId,
  timeZone,
  conversationId,
  onClose,
}: {
  projectId: string;
  timeZone: string;
  conversationId: string | null;
  onClose: () => void;
}) {
  const thread = useConversation(projectId, conversationId);
  return (
    <Dialog
      open={conversationId !== null}
      onClose={onClose}
      title={thread.data?.subject ?? 'Conversation'}
    >
      <ErrorAlert error={thread.error} title="We couldn't open this conversation" />
      {thread.isPending && conversationId ? (
        <SkeletonRows rows={3} label="Loading conversation…" />
      ) : null}
      {thread.data && conversationId ? (
        <div className="stack">
          <ol className="conversations__thread">
            {thread.data.messages.map((m) => (
              <li key={m.id} className="conversations__message">
                <span className="conversations__avatar" aria-hidden="true">
                  {initialsOf(m.authorName)}
                </span>
                <div>
                  <p className="conversations__who u-m-0">{m.authorName}</p>
                  <p className="conversations__body u-m-0">{m.body}</p>
                  <time className="u-caption" dateTime={m.createdAt}>
                    {relativeAge(m.createdAt, timeZone)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
          <ReplyForm key={conversationId} projectId={projectId} conversationId={conversationId} />
        </div>
      ) : null}
    </Dialog>
  );
}

function ReplyForm({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const post = usePostMessage(projectId, conversationId);
  const [body, setBody] = useState('');
  const ready = body.trim().length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    post.mutate(body.trim(), { onSuccess: () => setBody('') });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorAlert error={post.error} title="We couldn't send your reply" />
      <Textarea
        label="Reply"
        rows={3}
        value={body}
        maxLength={BODY_MAX}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="row-actions">
        <Button type="submit" disabled={!ready} loading={post.isPending}>
          Send reply
        </Button>
      </div>
    </form>
  );
}
