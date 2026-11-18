'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  NovaSuggestion,
  SkeletonRows,
  StatusPill,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useAnnouncement, useMarkRead, useNudge } from '../hooks/useAnnouncements';
import { readSummary, relativeAge } from '../lib/time';
import type { AnnouncementDetail } from '../data/api';

/** One announcement. Opening it marks it read; the sender also gets who has read it and Nova's flags. */
export function AnnouncementDialog({
  projectId,
  timeZone,
  announcementId,
  onClose,
}: {
  projectId: string;
  timeZone: string;
  announcementId: string | null;
  onClose: () => void;
}) {
  const detail = useAnnouncement(projectId, announcementId);
  const markRead = useMarkRead(projectId);
  const unread = detail.data?.unread ?? false;
  const { mutate } = markRead;

  useEffect(() => {
    if (announcementId && unread) mutate(announcementId);
  }, [announcementId, unread, mutate]);

  const a = detail.data;
  return (
    <Dialog open={announcementId !== null} onClose={onClose} title={a?.title ?? 'Announcement'}>
      <ErrorAlert error={detail.error} title="We couldn't open this announcement" />
      {detail.isPending && announcementId ? (
        <SkeletonRows rows={3} label="Loading announcement…" />
      ) : null}
      {a && announcementId ? (
        <div className="stack">
          <p className="u-caption u-m-0">
            {a.createdByName} ·{' '}
            <time dateTime={a.createdAt}>{relativeAge(a.createdAt, timeZone)}</time>
            {a.priority === 'important' ? (
              <>
                {' '}
                <StatusPill tone="warning">Important</StatusPill>
              </>
            ) : null}
          </p>
          <p className="announcements__body u-m-0">{a.body}</p>
          {a.receipts ? (
            <Receipts key={a.id} projectId={projectId} a={a} timeZone={timeZone} />
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function Receipts({
  projectId,
  a,
  timeZone,
}: {
  projectId: string;
  a: AnnouncementDetail;
  timeZone: string;
}) {
  const nudge = useNudge(projectId, a.id);
  const canNudge = a.flags.filter((f) => f.canNudge);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const picked = chosen ?? canNudge.map((f) => f.userId);
  const [sent, setSent] = useState<number | null>(null);

  return (
    <section className="stack" aria-label="Read receipts">
      <h3 className="panel-heading u-m-0">{a.receipts ? readSummary(a.receipts) : ''}</h3>
      {a.flags.length > 0 ? (
        <NovaSuggestion
          title={`${a.flags.length} ${a.flags.length === 1 ? 'person hasn’t' : 'people haven’t'} read this yet`}
          actions={
            <Button
              disabled={picked.length === 0}
              loading={nudge.isPending}
              onClick={() => nudge.mutate(picked, { onSuccess: (r) => setSent(r.nudged) })}
            >
              Send reminder to {picked.length}
            </Button>
          }
        >
          <p className="u-m-0">
            {a.readByHours ? `It was due to be read within ${a.readByHours} hours. ` : ''}
            Nothing is sent until you confirm who to remind.
          </p>
          <ul className="announcements__flags">
            {a.flags.map((f) => (
              <li key={f.userId}>
                <Checkbox
                  label={f.name}
                  hint={
                    f.canNudge
                      ? `${f.hoursOverdue} ${f.hoursOverdue === 1 ? 'hour' : 'hours'} overdue${f.isKey ? ' · key person' : ''}`
                      : 'Reminded recently'
                  }
                  disabled={!f.canNudge}
                  checked={f.canNudge && picked.includes(f.userId)}
                  onChange={() =>
                    setChosen(
                      picked.includes(f.userId)
                        ? picked.filter((x) => x !== f.userId)
                        : [...picked, f.userId],
                    )
                  }
                />
              </li>
            ))}
          </ul>
          <ErrorAlert error={nudge.error} title="We couldn't send the reminder" />
        </NovaSuggestion>
      ) : null}
      {sent !== null ? (
        <Alert tone="success">
          {sent === 0
            ? 'Nobody needed a reminder right now.'
            : `Reminder sent to ${sent} ${sent === 1 ? 'person' : 'people'}.`}
        </Alert>
      ) : null}
      <ul className="announcements__receipts">
        {(a.recipients ?? []).map((r) => (
          <li key={r.userId}>
            <span>
              {r.name}
              {r.isKey ? <span className="u-caption"> · key</span> : null}
            </span>
            {r.readAt ? (
              <StatusPill tone="success">Read {relativeAge(r.readAt, timeZone)}</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not read</StatusPill>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
