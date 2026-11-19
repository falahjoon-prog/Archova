'use client';

import { useState } from 'react';
import { Button, Card, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { companyName } from '@/shared/mocks/directory';
import { useLevelBids } from '../hooks/useQuotes';
import { LEVEL_DISCLAIMER, type BidLevelAnswer } from '../lib/bid-level';
import type { Quote, ScopeLine } from '../lib/quote-types';
import { money } from './money';

/**
 * Nova levels every confirmed bid: normalised totals and ranks (worked out by code), where each bid leaves scope out,
 * the risks, and the bid Nova would take forward. Nova sees anonymous bids; the names below are added here. Suggests only.
 */
export function LevellingPanel({
  packageId,
  quotes,
  scope,
}: {
  packageId: string;
  quotes: readonly Quote[];
  scope: readonly ScopeLine[];
}) {
  const level = useLevelBids(packageId);
  const [answer, setAnswer] = useState<BidLevelAnswer | null>(null);
  const [question, setQuestion] = useState('');

  const whoIs = (quoteId: string) => {
    const q = quotes.find((x) => x.id === quoteId);
    return q ? companyName(q.companyId) : 'Unknown company';
  };
  const labelWho = (label: string) => {
    const b = answer?.bids.find((x) => x.label === label);
    return b ? `${label}: ${whoIs(b.quoteId)}` : label;
  };
  const scopeName = (key: string | null) =>
    key ? (scope.find((s) => s.key === key)?.description ?? key) : null;

  const run = (said?: string) =>
    level.mutate(
      { ...(said?.trim() ? { question: said.trim() } : {}) },
      { onSuccess: (a) => setAnswer(a) },
    );
  const sorted = answer ? [...answer.bids].sort((a, b) => a.rank - b.rank) : [];
  const rec = answer?.recommendation ?? null;

  return (
    <Card
      title="Nova: level the bids"
      headingLevel={3}
      actions={<StatusPill tone="ai">AI assistant</StatusPill>}
      className="level"
    >
      <div className="stack">
        <p className="u-m-0">
          Nova puts every confirmed bid on your scope schedule, prices what each bid leaves out at
          the median of the other bids, spots scope gaps and exclusions, and says which bid she
          would take forward. Nova sees prices and terms only, never who quoted.
        </p>
        <div className="row-actions">
          <Button disabled={level.isPending || quotes.length === 0} onClick={() => run()}>
            {answer ? 'Level again' : 'Level the bids'}
          </Button>
        </div>
        <ErrorAlert error={level.error} title="Nova couldn't level these bids" />
        <div aria-live="polite" className="stack">
          {level.isPending ? <p className="u-caption u-m-0">Nova is levelling the bids…</p> : null}
          {answer && !level.isPending ? (
            <div className="stack level__answer">
              <p className="u-m-0">{answer.summary}</p>
              <div className="table-wrap">
                <table className="table level__table">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Bid</th>
                      <th scope="col" className="level__num">
                        Quoted, ex GST
                      </th>
                      <th scope="col" className="level__num">
                        Levelled, ex GST
                      </th>
                      <th scope="col">Left out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((b) => (
                      <tr key={b.quoteId}>
                        <td>{b.rank}</td>
                        <th scope="row">
                          {labelWho(b.label)}
                          {b.validityExpired ? <span className="tag">Validity passed</span> : null}
                        </th>
                        <td className="level__num">{money(b.totalCents)}</td>
                        <td className="level__num">{money(b.normalisedCents)}</td>
                        <td>
                          {b.gaps.length
                            ? b.gaps
                                .map(
                                  (g) =>
                                    `${scopeName(g.scopeKey)}${g.allowanceCents === null ? '' : ` (+${money(g.allowanceCents)})`}`,
                                )
                                .join(', ')
                            : 'Nothing'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {answer.gaps.length ? (
                <ul className="plain-list">
                  {answer.gaps.map((g, i) => (
                    <li key={i}>{g.text}</li>
                  ))}
                </ul>
              ) : null}
              {answer.risks.length ? (
                <ul className="plain-list">
                  {answer.risks.map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              ) : null}
              {answer.mappings.length ? (
                <div className="stack">
                  <strong>Lines Nova would place on the schedule</strong>
                  <ul className="plain-list">
                    {answer.mappings.map((m, i) => (
                      <li key={i}>
                        {m.bid}: “{m.description}” ({money(m.amountCents)}) looks like{' '}
                        {scopeName(m.scopeKey)}. {m.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="u-caption u-m-0">
                    Nothing is changed. Edit the quote to move a line.
                  </p>
                </div>
              ) : null}
              {rec ? (
                <div className="level__rec stack">
                  <strong>
                    {rec.bid
                      ? `Nova would take forward ${labelWho(rec.bid)}`
                      : 'Nova can’t pick a bid yet'}
                  </strong>
                  {rec.reasoning ? <p className="u-m-0">{rec.reasoning}</p> : null}
                  {rec.bid && rec.isLowestNormalised === false ? (
                    <p className="u-caption u-m-0">This is not the lowest levelled price.</p>
                  ) : null}
                  {rec.conditions.length ? (
                    <ul className="plain-list">
                      {rec.conditions.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {answer.notes.length ? (
                <ul className="plain-list u-caption">
                  {answer.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
              <div className="level__ask">
                <TextField
                  label="Ask Nova about these bids"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={1000}
                  hint="For example: what if Bid B renews its validity, or which exclusion worries you most?"
                />
                <div className="row-actions">
                  <Button
                    variant="secondary"
                    disabled={level.isPending || !question.trim()}
                    onClick={() => run(question)}
                  >
                    Ask
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <p className="u-caption u-m-0">{LEVEL_DISCLAIMER}</p>
      </div>
    </Card>
  );
}
