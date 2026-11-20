'use client';

import { Button, EmptyState, PageHeader, SkeletonRows, StatusPill } from '@archova/ui';
import { Building2 } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useDecideContractor, useCompanyContractors } from '../hooks/useContractors';

/** A company's contractors (free tier): requests to accept or reject, and who is already added. */
export function CompanyContractorsScreen() {
  const decide = useDecideContractor();
  const pending = useCompanyContractors('requested');
  const accepted = useCompanyContractors('accepted');
  const busy = decide.accept.isPending || decide.reject.isPending || decide.end.isPending;
  const waiting = pending.query.data?.pages.flatMap((p) => p.data) ?? [];
  const added = accepted.query.data?.pages.flatMap((p) => p.data) ?? [];
  const error =
    pending.query.error ??
    accepted.query.error ??
    decide.accept.error ??
    decide.reject.error ??
    decide.end.error;

  return (
    <div className="stack">
      <PageHeader
        title="Contractors"
        description="Contractors who asked to work for you. Only owners and admins can accept or reject."
      />
      <ErrorAlert error={error} title="We couldn't complete that" />

      <section className="stack" aria-labelledby="ctr-pending">
        <h2 id="ctr-pending" className="u-h3">
          Requests waiting
        </h2>
        {pending.query.isPending ? (
          <SkeletonRows rows={2} />
        ) : waiting.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No requests waiting"
            description="New requests from contractors appear here."
          />
        ) : (
          <ul className="inbox-list">
            {waiting.map((c) => (
              <li key={c.id} className="inbox-list__item">
                <div className="inbox-list__main">
                  <p className="inbox-list__title">{c.displayName}</p>
                  <p className="inbox-list__body">{c.profession}</p>
                </div>
                <div className="inbox-list__side">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => decide.accept.mutate(c.id)}
                    aria-label={`Accept ${c.displayName}`}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => decide.reject.mutate(c.id)}
                    aria-label={`Reject ${c.displayName}`}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pending.query.hasNextPage ? (
          <Button
            variant="secondary"
            loading={pending.query.isFetchingNextPage}
            onClick={() => pending.query.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="ctr-added">
        <h2 id="ctr-added" className="u-h3">
          Your contractors
        </h2>
        {accepted.query.isPending ? (
          <SkeletonRows rows={3} />
        ) : added.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No contractors yet"
            description="Contractors you accept are listed here."
          />
        ) : (
          <ul className="inbox-list">
            {added.map((c) => (
              <li key={c.id} className="inbox-list__item">
                <div className="inbox-list__main">
                  <p className="inbox-list__title">{c.displayName}</p>
                  <p className="inbox-list__body">
                    {[c.profession, c.phone].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="inbox-list__side">
                  <StatusPill tone="success">Added</StatusPill>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={busy}
                    onClick={() => decide.end.mutate(c.id)}
                    aria-label={`Remove ${c.displayName}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {accepted.query.hasNextPage ? (
          <Button
            variant="secondary"
            loading={accepted.query.isFetchingNextPage}
            onClick={() => accepted.query.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </section>
    </div>
  );
}
