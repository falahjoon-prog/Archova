'use client';

import { Alert, Button, SkeletonRows, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useInductionCurrency, useInductionRefresh } from '../hooks/useBuilder';
import { changeSummary, parseRefresh, type AiSuggestion, type ParsedRefresh } from '../lib/refresh';
import { SECTION_LABELS } from '../lib/types';

/**
 * Whether the documents Nova cited for this induction still stand, and a redraft of just the sections a change
 * touches (F33 I2). The check is free; the redraft costs one Nova credit and is only a suggestion until the
 * builder takes it into the draft, which they then save and approve like any edit (P6).
 */
export function CurrencyPanel({
  suggestionId,
  disabled,
  pending,
  onPending,
  onTake,
}: {
  /** `draftAiSuggestionId` of the induction (or the refresh the builder last took in). */
  suggestionId: string;
  disabled: boolean;
  /** The redraft waiting to be taken in or dismissed; kept by the editor so it survives tab changes. */
  pending: AiSuggestion | null;
  onPending: (s: AiSuggestion | null) => void;
  onTake: (r: ParsedRefresh) => void;
}) {
  const currency = useInductionCurrency(suggestionId);
  const nova = useInductionRefresh();
  const parsed = pending ? parseRefresh(pending) : null;

  return (
    <section className="card stack" aria-labelledby="currency-h">
      <div className="row-actions">
        <h2 id="currency-h" className="u-m-0">
          Are the cited documents current?
        </h2>
        {currency.data ? (
          <StatusPill tone={currency.data.upToDate ? 'success' : 'warning'}>
            {currency.data.upToDate ? 'Up to date' : 'Out of date'}
          </StatusPill>
        ) : null}
        <Button
          variant="secondary"
          disabled={currency.isFetching}
          onClick={() => void currency.refetch()}
        >
          {currency.isFetching ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      {currency.isPending ? <SkeletonRows label="Checking cited documents…" /> : null}
      <ErrorAlert error={currency.error} title="We couldn't check the cited documents" />
      {currency.data?.upToDate ? (
        <p className="u-m-0">
          Every document and drawing Nova cited is still the current revision.
        </p>
      ) : null}
      {currency.data && !currency.data.upToDate ? (
        <>
          {currency.data.changed.length ? (
            <ul className="plain-list">
              {currency.data.changed.map((c) => (
                <li key={c.sourceId} className="plain-list__item">
                  <strong>{c.title}</strong>
                  <span className="u-caption">{changeSummary(c)}</span>
                  <span className="u-caption">
                    Used in {c.sections.map((s) => SECTION_LABELS[s]).join(', ') || 'no section'}
                    {c.quizQuestions
                      ? ` · ${c.quizQuestions} quiz ${c.quizQuestions === 1 ? 'question' : 'questions'}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {currency.data.hiddenChanges ? (
            <Alert tone="info">
              {currency.data.hiddenChanges === 1
                ? '1 more document you cannot open has changed.'
                : `${currency.data.hiddenChanges} more documents you cannot open have changed.`}{' '}
              Ask a project admin to check those sections.
            </Alert>
          ) : null}
          {!parsed ? (
            <div className="row-actions">
              <Button
                disabled={disabled || nova.redraft.isPending || currency.data.changed.length === 0}
                onClick={() => nova.redraft.mutate(suggestionId, { onSuccess: onPending })}
              >
                {nova.redraft.isPending ? 'Nova is redrafting…' : 'Redraft with Nova'}
              </Button>
              <span className="u-caption">
                Redrafts only the sections above. Uses 1 Nova credit; nothing changes until you take
                it in.
              </span>
            </div>
          ) : null}
          <ErrorAlert error={nova.redraft.error} title="Nova couldn't redraft" />
        </>
      ) : null}
      {parsed ? (
        <Alert tone="info" title="Nova's redraft is ready">
          <div className="stack">
            {parsed.redrafted.length ? (
              <p className="u-m-0">
                Redrafted: {parsed.redrafted.map((s) => SECTION_LABELS[s.key]).join(', ')}
                {parsed.quiz.length ? ` and ${parsed.quiz.length} quiz questions` : ''}. Taking it
                in replaces those sections' slides and questions; every other section stays as you
                have it.
              </p>
            ) : null}
            {parsed.skipped.length ? (
              <p className="u-m-0">
                Left as they were, because they also rest on a document you cannot open:{' '}
                {parsed.skipped.map((k) => SECTION_LABELS[k]).join(', ')}.
              </p>
            ) : null}
            {parsed.missing.map((m) => (
              <p key={m.key} className="u-m-0">
                <strong>{SECTION_LABELS[m.key]}</strong> has no current document to draft from.{' '}
                {m.gap}
              </p>
            ))}
            <div className="row-actions">
              <Button
                disabled={disabled || parsed.redrafted.length === 0}
                onClick={() => onTake(parsed)}
              >
                Take redrafted sections into the draft
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  nova.decide.mutate({ suggestionId: parsed.suggestionId, decision: 'rejected' });
                  onPending(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}
    </section>
  );
}
