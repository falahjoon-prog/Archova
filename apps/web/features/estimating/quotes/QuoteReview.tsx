'use client';

import { useState } from 'react';
import { Button, NovaSuggestion, StatusPill } from '@archova/ui';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { Quote, ScopeLine } from '../lib/quote-types';
import { money, parseDollars } from './money';
import type { SourceTarget } from './SourceDialog';

/**
 * Review what Nova read from a quote (F1.3b step 3): every value links to its page, any amount can be corrected
 * (the original is kept as feedback), and nothing counts in the comparison until the estimator confirms.
 */
export function QuoteReview({
  quote,
  scope,
  busy,
  onCorrect,
  onConfirm,
  onDecline,
  onSource,
}: {
  quote: Quote;
  scope: ScopeLine[];
  busy: boolean;
  onCorrect: (lineId: string, cents: number) => void;
  onConfirm: () => void;
  /** Take the quote out of the comparison. */
  onDecline: () => void;
  onSource: (t: SourceTarget) => void;
}) {
  const { companyName } = useProjectDirectory();
  const editable = quote.status === 'ready_to_review';
  const scopeName = (key: string | null) =>
    scope.find((s) => s.key === key)?.description ?? 'Not in scope';
  const missing = scope.filter(
    (s) =>
      !quote.lines.some((l) => l.scopeKey === s.key) &&
      !quote.exclusions.some((e) => e.scopeKey === s.key),
  );

  const body = (
    <div className="stack">
      <div className="table-wrap">
        <table className="table">
          <caption className="u-visually-hidden">Lines read from {quote.fileName}</caption>
          <thead>
            <tr>
              <th scope="col">Line in the quote</th>
              <th scope="col">Matches scope</th>
              <th scope="col" className="ac-table__num">
                Amount ex GST
              </th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.id}>
                <th scope="row">
                  {l.description}
                  {l.isProvisional ? (
                    <>
                      {' '}
                      <StatusPill tone="warning">Provisional sum</StatusPill>
                    </>
                  ) : null}
                </th>
                <td>{scopeName(l.scopeKey)}</td>
                <td className="ac-table__num">
                  {editable ? (
                    <AmountInput
                      label={`Amount for ${l.description}`}
                      cents={l.amountCents}
                      onCommit={(c) => onCorrect(l.id, c)}
                    />
                  ) : (
                    money(l.amountCents)
                  )}
                  {l.originalAmountCents !== null ? (
                    <div className="u-caption">
                      Corrected. Nova read {money(l.originalAmountCents)}
                    </div>
                  ) : null}
                </td>
                <td>
                  {l.source ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        onSource({ fileName: quote.fileName, label: l.description, ref: l.source! })
                      }
                    >
                      Page {l.source.page}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {quote.exclusions.length || quote.qualifications.length ? (
        <ul className="plain-list">
          {quote.exclusions.map((e) => (
            <li key={e.id}>
              <StatusPill tone="danger">Exclusion</StatusPill> {e.text}
            </li>
          ))}
          {quote.qualifications.map((q) => (
            <li key={q.id}>
              <StatusPill tone="warning">Qualification</StatusPill> {q.text}
            </li>
          ))}
        </ul>
      ) : null}
      {missing.length ? (
        <p className="u-m-0">
          <strong>Not priced:</strong> {missing.map((s) => s.description).join('; ')}
        </p>
      ) : null}
    </div>
  );

  if (!editable) return body;
  return (
    <NovaSuggestion
      title={`Read from ${quote.fileName} (${companyName(quote.companyId)})`}
      actions={
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onDecline}>
            Decline quote
          </Button>
          <Button size="sm" disabled={busy} onClick={onConfirm}>
            Confirm quote
          </Button>
        </>
      }
    >
      {body}
    </NovaSuggestion>
  );
}

function AmountInput({
  label,
  cents,
  onCommit,
}: {
  label: string;
  cents: number;
  onCommit: (c: number) => void;
}) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  return (
    <input
      className="ac-input ac-input--narrow ac-table__num"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const c = parseDollars(text);
        if (c === null) setText((cents / 100).toFixed(2));
        else if (c !== cents) onCommit(c);
      }}
    />
  );
}
