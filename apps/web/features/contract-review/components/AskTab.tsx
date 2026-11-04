'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, NovaFeedback, Textarea } from '@archova/ui';
import { toErrorView } from '@/shared/lib/errors';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ContractAnswer, ContractReview } from '../data/api';
import { useAskContract, useRateAnswer } from '../hooks/useContractReview';
import { SourceQuote } from './SourceQuote';

const MAX_QUESTION = 500;

/**
 * Tab 4 (design/09 CR2): "Where does the contract say...?" Nova answers from the contract's pages only and quotes
 * the clauses. When the contract is silent the API says so, and that wording is shown as it comes. The server keeps
 * nothing, so the questions asked here live on this screen until it is closed.
 */
export function AskTab({ review }: { review: ContractReview }) {
  const project = useCurrentProject();
  const ask = useAskContract(project.projectId);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ContractAnswer[]>([]);
  const trimmed = question.trim();
  const tooShort = trimmed.length < 3;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tooShort || ask.isPending) return;
    ask.mutate(
      { suggestionId: review.suggestionId, question: trimmed },
      {
        onSuccess: (a) => {
          setTurns((t) => [a, ...t]);
          setQuestion('');
        },
      },
    );
  };

  return (
    <div className="stack">
      <form className="stack" onSubmit={submit}>
        <Textarea
          label="Where does the contract say…?"
          hint="Nova answers only from this contract and quotes the clause. It does not give a view on whether a clause is fair, valid or safe to sign."
          rows={3}
          maxLength={MAX_QUESTION}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="For example: how much retention does the Principal hold?"
        />
        <div className="row-actions">
          <Button type="submit" disabled={tooShort || ask.isPending}>
            {ask.isPending ? 'Nova is reading…' : 'Ask Nova'}
          </Button>
          <span className="u-caption">
            {trimmed.length}/{MAX_QUESTION} · uses 2 Nova credits
          </span>
        </div>
      </form>
      {ask.isError ? (
        <Alert tone="danger" title="Nova couldn't answer that">
          {toErrorView(ask.error).message}
        </Alert>
      ) : null}
      {!turns.length && !ask.isPending ? (
        <p className="u-m-0">
          Questions you ask appear here. They are not saved: copy anything you need to keep.
        </p>
      ) : null}
      <ul className="plain-list" aria-label="Questions and answers">
        {turns.map((t) => (
          <li key={t.runId} className="cr-flag-item">
            <AnswerCard turn={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerCard({ turn }: { turn: ContractAnswer }) {
  const rate = useRateAnswer();
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const silent = turn.kind === 'not_addressed';
  const unread = turn.unreadPages.length > 0 || turn.truncated;
  return (
    <article className="cr-flag" aria-label={`Answer to: ${turn.question}`}>
      <h3 className="cr-flag__title">{turn.question}</h3>
      <p className="u-m-0">{turn.answer}</p>
      {turn.citations.map((c, i) => (
        <SourceQuote key={i} source={c} />
      ))}
      {silent && unread ? (
        <p className="u-caption u-m-0">
          {turn.unreadPages.length
            ? `Nova couldn't read pages ${turn.unreadPages.join(', ')}, so the answer may be there. `
            : ''}
          {turn.truncated ? 'Part of the contract was left out, so the answer may be in it.' : ''}
        </p>
      ) : null}
      {turn.droppedCitations ? (
        <p className="u-caption u-m-0">
          {turn.droppedCitations === 1
            ? 'Nova named a clause that could not be found in the contract, so it is not shown.'
            : `Nova named ${turn.droppedCitations} clauses that could not be found in the contract, so they are not shown.`}
        </p>
      ) : null}
      <NovaFeedback
        value={rating}
        onChange={(v) => {
          setRating(v);
          rate.mutate({ runId: turn.runId, rating: v }, { onError: () => setRating(null) });
        }}
      />
    </article>
  );
}
