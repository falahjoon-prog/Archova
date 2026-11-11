'use client';

import { StatusPill } from '@archova/ui';
import type { AnnouncementSummary } from '../data/api';
import { readSummary, relativeAge } from '../lib/time';

/** The announcements as a list of buttons; unread ones carry a dot and bold title for the people they were sent to. */
export function AnnouncementList({
  items,
  timeZone,
  onOpen,
  page = false,
}: {
  items: readonly AnnouncementSummary[];
  timeZone: string;
  onOpen: (id: string) => void;
  page?: boolean;
}) {
  return (
    <ul className={page ? 'announcements__list announcements__list--page' : 'announcements__list'}>
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            className="announcements__item"
            onClick={() => onOpen(a.id)}
            aria-label={`Open announcement: ${a.title}${a.unread ? ' (unread)' : ''}`}
          >
            <span
              className={
                a.unread ? 'announcements__dot announcements__dot--unread' : 'announcements__dot'
              }
              aria-hidden="true"
            />
            <span className="announcements__text">
              <span
                className={
                  a.unread
                    ? 'announcements__title announcements__title--unread'
                    : 'announcements__title'
                }
              >
                {a.title}
                {a.priority === 'important' ? (
                  <>
                    {' '}
                    <StatusPill tone="warning">Important</StatusPill>
                  </>
                ) : null}
              </span>
              <span className="announcements__preview">{a.preview}</span>
              <span className="u-caption">
                {a.createdByName} ·{' '}
                <time dateTime={a.createdAt}>{relativeAge(a.createdAt, timeZone)}</time>
                {a.receipts ? ` · ${readSummary(a.receipts)}` : ''}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
