'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, Button, DescriptionList, SkeletonRows, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { transmittalLinkApi } from '../data/api';
import { PURPOSE_LABELS, formatTransmittalNumber, type TransmittalAccess } from '../lib/types';

const KEY = ['transmittal-link'] as const;

/** Takes the token out of the address bar so it isn't shared by screenshot, copy-paste or the Referer header. */
function stripToken() {
  if (window.location.pathname !== '/t/continue')
    window.history.replaceState(window.history.state, '', '/t/continue');
}

/**
 * What a recipient with no account sees (X45, Sam 11 §3): the cover details, each item to download, and one
 * button to confirm they have it. Opening the page records the "opened" receipt.
 */
export function TransmittalLinkScreen({ token }: { token: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return await transmittalLinkApi.open(token);
      } finally {
        stripToken();
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  const acknowledge = useMutation({
    mutationFn: transmittalLinkApi.acknowledge,
    onSuccess: (access) => qc.setQueryData(KEY, { state: 'open', access }),
  });
  const download = useMutation({
    mutationFn: transmittalLinkApi.download,
    // Navigating rather than opening a window, which browsers block after an await.
    onSuccess: (file) => window.location.assign(file.url),
  });
  useEffect(() => {
    document.title = 'Transmittal';
  }, []);

  const data = query.data;
  const access: TransmittalAccess | null = data?.state === 'open' ? data.access : null;

  return (
    <main id="main" className="link-page stack-lg">
      {query.isPending ? <SkeletonRows label="Opening your transmittal…" /> : null}
      <ErrorAlert error={query.error} title="We couldn't open this transmittal" />
      {data?.state === 'expired' ? (
        <Alert tone="warning" title="This link no longer works">
          Ask the sender for a new one.
        </Alert>
      ) : null}
      {access ? (
        <>
          <header className="stack">
            <p className="u-caption">
              {access.transmittal.fromOrg} · {access.transmittal.projectName}
            </p>
            <h1 className="u-m-0">
              {formatTransmittalNumber(access.transmittal.number)} {access.transmittal.subject}
            </h1>
          </header>
          <section className="ac-card" aria-label="Details">
            <DescriptionList
              items={[
                { label: 'Purpose', value: PURPOSE_LABELS[access.transmittal.purpose] },
                {
                  label: 'Response due',
                  value: access.transmittal.responseDue
                    ? formatLocalDate(access.transmittal.responseDue)
                    : '—',
                },
                ...(access.transmittal.message
                  ? [{ label: 'Message', value: access.transmittal.message }]
                  : []),
              ]}
            />
          </section>
          <section className="stack" aria-labelledby="link-items">
            <h2 id="link-items" className="panel-heading">
              Files ({access.items.length})
            </h2>
            <ul className="plain-list">
              {access.items.map((i) => (
                <li
                  key={`${i.revisionType}:${i.revisionId}`}
                  className="plain-list__item link-item"
                >
                  <span>
                    <strong>{i.title}</strong>
                    <span className="u-caption u-block">
                      {[i.number, `Rev ${i.rev}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {access.actions.includes('download') ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={
                        download.isPending && download.variables?.revisionId === i.revisionId
                      }
                      aria-label={`Download ${i.title}`}
                      onClick={() =>
                        download.mutate({ revisionType: i.revisionType, revisionId: i.revisionId })
                      }
                    >
                      Download
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <ErrorAlert error={download.error} title="We couldn't download that file" />
          </section>
          {access.actions.includes('acknowledge') ? (
            <section className="ac-card stack" aria-labelledby="link-ack">
              <h2 id="link-ack" className="panel-heading">
                Confirm you received it
              </h2>
              {access.recipient.acknowledgedAt ? (
                <StatusPill tone="success">Receipt confirmed</StatusPill>
              ) : (
                <>
                  <p className="u-m-0">
                    This tells {access.transmittal.fromOrg} that {access.recipient.email} has the
                    files.
                  </p>
                  <div>
                    <Button loading={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
                      Confirm receipt
                    </Button>
                  </div>
                  <ErrorAlert error={acknowledge.error} title="We couldn't record that" />
                </>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
