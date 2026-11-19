'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, Card, SkeletonRows, StatusPill, type StatusTone } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { clientLinkApi, type ClientView } from '../data/api';

/** Takes the token out of the address bar so it isn't shared by screenshot, copy-paste or the Referer header. */
function stripToken() {
  if (window.location.pathname !== '/c/continue')
    window.history.replaceState(window.history.state, '', '/c/continue');
}

const STATUS_LABEL = {
  done: 'Done',
  on_track: 'On track',
  at_risk: 'At risk',
  late: 'Late',
} as const;
const STATUS_TONE: Record<keyof typeof STATUS_LABEL, StatusTone> = {
  done: 'success',
  on_track: 'info',
  at_risk: 'warning',
  late: 'danger',
};

/**
 * What a client sees on the link the builder shared (X45): progress, what is coming up, changes already agreed and
 * photos the builder picked. Read-only, no account, and nothing with a price on it. One column on a phone.
 */
export function ClientLinkScreen({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ['client-link'],
    queryFn: async () => {
      try {
        return await clientLinkApi.open(token);
      } finally {
        stripToken();
      }
    },
    // The photo links last ten minutes; reopening the page fetches fresh ones.
    staleTime: 5 * 60_000,
    retry: false,
  });
  const data = query.data;
  const view = data?.state === 'open' ? data.view : null;
  useEffect(() => {
    document.title = view ? `${view.project.name}: progress` : 'Project progress';
  }, [view]);

  return (
    <main id="main" className="link-page link-page--wide stack-lg">
      {query.isPending ? <SkeletonRows label="Opening the progress page…" /> : null}
      <ErrorAlert error={query.error} title="We couldn't open this page" />
      {data?.state === 'expired' ? (
        <Alert tone="warning" title="This link no longer works">
          It may have expired or been turned off. Ask your builder for a new one.
        </Alert>
      ) : null}
      {view ? <ClientPage view={view} /> : null}
    </main>
  );
}

/** The client's page body, also used for the team's preview. */
export function ClientPage({ view }: { view: ClientView }) {
  const tz = view.project.timezone;
  return (
    <>
      <header className="stack">
        <p className="u-caption">{view.project.fromOrg}</p>
        <h1 className="u-m-0">{view.project.name}</h1>
        <p className="u-caption u-m-0">
          A read-only view shared with you. Please don&apos;t forward this link.
        </p>
      </header>

      {view.progress ? (
        <Card title="Progress">
          <div className="stack">
            <div>
              <progress
                max={100}
                value={view.progress.percentComplete}
                aria-label="Percent complete"
                style={{ width: '100%' }}
              />
              <p className="u-m-0">{view.progress.percentComplete}% complete</p>
            </div>
            <p className="u-caption u-m-0">
              {view.progress.title} · {formatLocalDate(view.progress.periodStart)} to{' '}
              {formatLocalDate(view.progress.periodEnd)}
            </p>
            {view.progress.summary ? (
              <p className="u-m-0" style={{ whiteSpace: 'pre-wrap' }}>
                {view.progress.summary}
              </p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Alert tone="info" title="No progress update yet">
          Your builder hasn&apos;t published one. Check back soon.
        </Alert>
      )}

      {view.milestones.length > 0 ? (
        <section className="stack" aria-labelledby="client-milestones">
          <h2 id="client-milestones" className="panel-heading">
            Coming up
          </h2>
          <ul className="plain-list">
            {view.milestones.map((m, i) => (
              <li key={`${m.name}-${i}`} className="plain-list__item link-item">
                <span>
                  <strong>{m.name}</strong>
                  <br />
                  <span className="u-caption">
                    {m.date ? formatLocalDate(m.date) : 'Date to be confirmed'}
                  </span>
                </span>
                <StatusPill tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.photos.length > 0 ? (
        <section className="stack" aria-labelledby="client-photos">
          <h2 id="client-photos" className="panel-heading">
            Photos
          </h2>
          <ul className="photo-tiles">
            {view.photos.map((p, i) => (
              <li key={`${p.url}-${i}`}>
                <a
                  className="photo-tiles__tile"
                  href={p.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open photo${p.caption ? `: ${p.caption}` : ''}`}
                >
                  {/* Signed storage links, not static assets, so next/image can't optimise them. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption} loading="lazy" />
                </a>
                {p.caption ? <p className="photo-tiles__caption u-caption">{p.caption}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.changes.length > 0 ? (
        <section className="stack" aria-labelledby="client-changes">
          <h2 id="client-changes" className="panel-heading">
            Approved changes
          </h2>
          <ul className="plain-list">
            {view.changes.map((c) => (
              <li key={c.reference} className="plain-list__item">
                <strong className="u-block">
                  {c.reference} {c.title}
                </strong>
                <span className="u-caption u-block">
                  {c.approvedAt ? `Approved ${formatInstant(c.approvedAt, tz)}` : 'Approved'}
                  {c.timeImpactDays > 0
                    ? ` · adds ${c.timeImpactDays} ${c.timeImpactDays === 1 ? 'day' : 'days'}`
                    : ''}
                </span>
                {c.description ? <p className="u-m-0">{c.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.updates.length > 1 ? (
        <section className="stack" aria-labelledby="client-history">
          <h2 id="client-history" className="panel-heading">
            Earlier updates
          </h2>
          <ul className="plain-list">
            {view.updates.slice(1).map((u, i) => (
              <li key={`${u.title}-${i}`} className="plain-list__item">
                <strong className="u-block">{u.title}</strong>
                <span className="u-caption u-block">
                  {u.percentComplete}% complete · {formatLocalDate(u.periodStart)} to{' '}
                  {formatLocalDate(u.periodEnd)}
                </span>
                {u.summary ? (
                  <p className="u-m-0" style={{ whiteSpace: 'pre-wrap' }}>
                    {u.summary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
