import type { ReactNode } from 'react';

export interface ActivityEntry {
  id: string;
  /** Who did it: "Priya Shah (Harbour Build)". */
  actor: ReactNode;
  /** What happened: "changed the due date". */
  action: ReactNode;
  /** Before → after, when relevant. */
  change?: { before: ReactNode; after: ReactNode };
  /** Already formatted in the project's time zone. */
  at: ReactNode;
  /** ISO timestamp for `<time dateTime>`. */
  atIso: string;
  detail?: ReactNode;
}

/**
 * Activity / audit trail (design 02 §7.4): who, what, before → after, when. Immutable look: no edit controls.
 */
export function ActivityTimeline({
  entries,
  label = 'Activity',
}: {
  entries: readonly ActivityEntry[];
  label?: string;
}) {
  if (entries.length === 0) return <p className="ac-muted">No activity yet.</p>;
  return (
    <ol className="ac-timeline" aria-label={label}>
      {entries.map((e) => (
        <li key={e.id} className="ac-timeline__item">
          <p className="ac-timeline__line">
            <strong>{e.actor}</strong> {e.action}
            {e.change ? (
              <>
                {': '}
                <span className="ac-timeline__before">{e.change.before}</span>
                <span aria-hidden="true"> → </span>
                <span className="ac-visually-hidden"> to </span>
                <span>{e.change.after}</span>
              </>
            ) : null}
          </p>
          {e.detail ? <div className="ac-timeline__detail">{e.detail}</div> : null}
          <time className="ac-timeline__at" dateTime={e.atIso}>
            {e.at}
          </time>
        </li>
      ))}
    </ol>
  );
}
