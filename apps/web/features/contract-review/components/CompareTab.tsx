'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, NovaFeedback, Select, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ContractChange, ContractComparison, ContractReview } from '../data/api';
import { useCompareContracts, useContractReviews, useRateAnswer } from '../hooks/useContractReview';
import { SourceQuote } from './SourceQuote';

const KIND_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed' } as const;
const KIND_TONE = { added: 'info', removed: 'warning', changed: 'neutral' } as const;

/**
 * Tab 5 (design/09 CR2): what changed between this contract and another one reviewed on the project (a later
 * version, or a different contract). Nova lists the differences with the clause quoted from each side; it says
 * nothing about which is better. The server keeps nothing, so the result lives on this screen until it is closed.
 */
export function CompareTab({ review }: { review: ContractReview }) {
  const project = useCurrentProject();
  const reviews = useContractReviews(project.projectId);
  const compare = useCompareContracts(project.projectId);
  const [otherId, setOtherId] = useState('');
  const [result, setResult] = useState<ContractComparison | null>(null);
  const candidates = (reviews.data ?? []).filter((r) => r.suggestionId !== review.suggestionId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!otherId || compare.isPending) return;
    compare.mutate(
      { baseReviewId: review.suggestionId, otherReviewId: otherId },
      { onSuccess: setResult },
    );
  };

  return (
    <div className="stack">
      <form className="stack" onSubmit={submit} aria-label="Compare contracts">
        <Select
          label="Compare this contract with"
          hint="Pick a later version of this contract, or a different contract, that you have already reviewed on this project."
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          placeholder={reviews.isPending ? 'Loading reviews…' : 'Choose a reviewed contract'}
          options={candidates.map((r) => ({
            value: r.suggestionId,
            label: `${r.fileName} · ${formatInstant(r.createdAt, project.timezone)}`,
          }))}
        />
        {reviews.data && !candidates.length ? (
          <p className="u-caption u-m-0">
            No other reviewed contract on this project yet. Review the second contract first.
          </p>
        ) : null}
        <div className="row-actions">
          <Button type="submit" loading={compare.isPending} disabled={!otherId}>
            Compare
          </Button>
          <span className="u-caption">Uses 5 Nova credits.</span>
        </div>
      </form>
      <ErrorAlert error={reviews.error} title="We couldn't load the other reviews" />
      <ErrorAlert error={compare.error} title="Nova couldn't compare these contracts" />
      {compare.isPending ? (
        <Alert tone="info" title="Nova is reading both contracts">
          This can take a minute.
        </Alert>
      ) : null}
      {result ? <Result result={result} /> : null}
    </div>
  );
}

function Result({ result }: { result: ContractComparison }) {
  const rate = useRateAnswer();
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const dropped = result.dropped.notOnPage + result.dropped.bannedWords + result.dropped.notAChange;
  const unread = [result.base, result.other].filter((c) => c.unreadPages.length || c.truncated);
  return (
    <section className="stack" aria-label="Changes">
      <h3 className="cr-flag__title">
        {result.other.fileName} compared with {result.base.fileName}
      </h3>
      {unread.map((c) => (
        <Alert key={c.suggestionId} tone="warning" title={`Part of ${c.fileName} was not read`}>
          {c.unreadPages.length
            ? `Pages ${c.unreadPages.join(', ')} have no text Nova can read. `
            : ''}
          {c.truncated
            ? 'The contract is longer than Nova reads in one go, so some pages were cut. '
            : ''}
          Changes there are not listed.
        </Alert>
      ))}
      <p className="u-m-0" role="status" aria-live="polite">
        {result.changes.length
          ? `${result.changes.length} ${result.changes.length === 1 ? 'change' : 'changes'} found`
          : 'Nova found no changes it can show. This does not mean the contracts match: Nova only lists differences it can quote.'}
      </p>
      <ul className="plain-list" aria-label="Changes between the contracts">
        {result.changes.map((c, i) => (
          <li key={i} className="cr-flag-item">
            <ChangeCard change={c} base={result.base.fileName} other={result.other.fileName} />
          </li>
        ))}
      </ul>
      {dropped ? (
        <p className="u-caption u-m-0">
          {dropped === 1
            ? 'Nova named one change that could not be supported from the pages, so it is not shown.'
            : `Nova named ${dropped} changes that could not be supported from the pages, so they are not shown.`}
        </p>
      ) : null}
      <p className="u-caption u-m-0">
        Nova lists what differs. It does not say which version is better or whether to sign: check
        with your lawyer.
      </p>
      <NovaFeedback
        value={rating}
        onChange={(v) => {
          setRating(v);
          rate.mutate({ runId: result.runId, rating: v }, { onError: () => setRating(null) });
        }}
      />
    </section>
  );
}

function ChangeCard({
  change,
  base,
  other,
}: {
  change: ContractChange;
  base: string;
  other: string;
}) {
  return (
    <article className="cr-flag" aria-label={`${KIND_LABEL[change.kind]}: ${change.topic}`}>
      <div className="cr-flag__head">
        <StatusPill tone={KIND_TONE[change.kind]}>{KIND_LABEL[change.kind]}</StatusPill>
        <h4 className="cr-flag__title">{change.topic}</h4>
      </div>
      <p className="u-m-0">{change.summary}</p>
      <div className="cr-compare__sides">
        <div className="cr-compare__side">
          <strong className="u-caption">{base}</strong>
          {change.base ? (
            <SourceQuote source={change.base} />
          ) : (
            <p className="u-caption u-m-0">Not in this contract.</p>
          )}
        </div>
        <div className="cr-compare__side">
          <strong className="u-caption">{other}</strong>
          {change.other ? (
            <SourceQuote source={change.other} />
          ) : (
            <p className="u-caption u-m-0">Not in this contract.</p>
          )}
        </div>
      </div>
    </article>
  );
}
