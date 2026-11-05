'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, Button, DescriptionList, SkeletonRows, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { tenderLinkApi, type TenderAccess } from '../data/api';

const KEY = ['tender-link'] as const;

/** Takes the token out of the address bar so it isn't shared by screenshot, copy-paste or the Referer header. */
function stripToken() {
  if (window.location.pathname !== '/q/continue')
    window.history.replaceState(window.history.state, '', '/q/continue');
}

const dueFormat = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'full',
  timeStyle: 'short',
});

/**
 * What an invited company with no account sees (X45, Sam 11 §3): who is asking, the scope, the due date, and two
 * buttons to say whether they will quote. Opening the page marks the invite viewed.
 */
export function TenderLinkScreen({ token }: { token: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return await tenderLinkApi.open(token);
      } finally {
        stripToken();
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  const respond = useMutation({
    mutationFn: tenderLinkApi.respond,
    onSuccess: (access) => qc.setQueryData(KEY, { state: 'open', access }),
  });
  useEffect(() => {
    document.title = 'Tender invitation';
  }, []);

  const data = query.data;
  const access: TenderAccess | null = data?.state === 'open' ? data.access : null;
  const status = access?.invite.status;

  return (
    <main id="main" className="link-page stack-lg">
      {query.isPending ? <SkeletonRows label="Opening your invitation…" /> : null}
      <ErrorAlert error={query.error} title="We couldn't open this invitation" />
      {data?.state === 'expired' ? (
        <Alert tone="warning" title="This link no longer works">
          The tender may have closed. Ask the sender for a new link.
        </Alert>
      ) : null}
      {access ? (
        <>
          <header className="stack">
            <p className="u-caption">
              {access.package.fromOrg} · {access.package.projectName}
            </p>
            <h1 className="u-m-0">
              {access.package.number} {access.package.name}
            </h1>
          </header>
          <section className="ac-card" aria-label="Details">
            <DescriptionList
              items={[
                { label: 'Trade', value: access.package.trade },
                {
                  label: 'Quotes due',
                  value: access.package.dueAt
                    ? dueFormat.format(new Date(access.package.dueAt))
                    : '—',
                },
              ]}
            />
          </section>
          <section className="stack" aria-labelledby="tender-scope">
            <h2 id="tender-scope" className="panel-heading">
              Scope ({access.package.scope.length})
            </h2>
            <ul className="plain-list">
              {access.package.scope.map((line, i) => (
                <li key={i} className="plain-list__item">
                  {line.description}
                </li>
              ))}
            </ul>
          </section>
          {access.actions.includes('respond') ? (
            <section className="ac-card stack" aria-labelledby="tender-respond">
              <h2 id="tender-respond" className="panel-heading">
                Will you quote?
              </h2>
              {status === 'submitted' ? (
                <StatusPill tone="success">Quote received</StatusPill>
              ) : (
                <>
                  {status === 'intends_to_quote' ? (
                    <StatusPill tone="success">You said you will quote</StatusPill>
                  ) : status === 'declined' ? (
                    <StatusPill tone="neutral">You declined</StatusPill>
                  ) : null}
                  <p className="u-m-0">
                    This tells {access.package.fromOrg} that {access.invite.email ?? 'your company'}{' '}
                    {status === 'declined' ? 'has changed its mind' : 'has an answer'}. You can
                    change your answer until you send a quote.
                  </p>
                  <div className="row-actions">
                    <Button
                      variant={status === 'intends_to_quote' ? 'secondary' : 'primary'}
                      disabled={status === 'intends_to_quote'}
                      loading={respond.isPending && respond.variables === 'intends_to_quote'}
                      onClick={() => respond.mutate('intends_to_quote')}
                    >
                      We will quote
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={status === 'declined'}
                      loading={respond.isPending && respond.variables === 'declined'}
                      onClick={() => respond.mutate('declined')}
                    >
                      We&apos;ll pass
                    </Button>
                  </div>
                  <ErrorAlert error={respond.error} title="We couldn't record that" />
                </>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
