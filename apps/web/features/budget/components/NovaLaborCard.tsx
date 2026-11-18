'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { LaborExplanation, LaborTurn } from '../data/api';
import { useExplainLabor } from '../hooks/useBudget';

/**
 * Nova on a cost code that is behind plan: likely causes to check on site, questions to narrow it down, and a place to
 * talk it through. Nova suggests only; nothing on the plan, quantities or timesheets changes.
 */
export function NovaLaborCard({
  costCodeId,
  code,
  onDone,
}: {
  costCodeId: string;
  code: string;
  onDone: () => void;
}) {
  const project = useCurrentProject();
  const explain = useExplainLabor(project.projectId);
  const [answer, setAnswer] = useState<LaborExplanation | null>(null);
  const [question, setQuestion] = useState('');
  const asked = useRef(false);

  const ask = (q: string, history: LaborTurn[]) =>
    explain.mutate(
      { costCodeId, ...(q ? { question: q } : {}), history },
      {
        onSuccess: (a) => {
          setAnswer(a);
          setQuestion('');
        },
      },
    );

  // The opening read starts when the card opens.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ask('', []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(e: FormEvent) {
    e.preventDefault();
    if (question.trim() && answer) ask(question.trim(), answer.history);
  }

  return (
    <Card title={`Ask Nova about ${code}`}>
      <div className="stack-lg">
        <ErrorAlert error={explain.error} title="Nova couldn't look at this cost code" />
        {explain.isPending && !answer ? (
          <p className="u-m-0">Nova is looking at the figures…</p>
        ) : null}
        {answer ? (
          <>
            <ul className="stack-sm u-m-0" aria-label="Conversation with Nova">
              {answer.history.map((t, i) => (
                <li key={i} className={t.role === 'user' ? 'u-caption' : undefined}>
                  <strong>{t.role === 'user' ? 'You: ' : 'Nova: '}</strong>
                  {t.text}
                </li>
              ))}
            </ul>
            {answer.causes.length > 0 ? (
              <ul className="stack-sm u-m-0" aria-label="Things to check">
                {answer.causes.map((c) => (
                  <li key={c.title}>
                    <StatusPill tone={c.likelihood === 'likely' ? 'warning' : 'neutral'}>
                      {c.likelihood === 'likely' ? 'Likely' : 'Possible'}
                    </StatusPill>{' '}
                    <strong>{c.title}</strong>
                    <p className="u-m-0">{c.why}</p>
                    <p className="u-m-0 u-caption">Check: {c.check}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {answer.questions.length > 0 ? (
              <div>
                <p className="u-m-0">
                  <strong>Worth asking on site</strong>
                </p>
                <ul className="u-m-0">
                  {answer.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {answer.notes.map((n) => (
              <Alert key={n} tone="warning">
                {n}
              </Alert>
            ))}
            <p className="u-m-0 u-caption">{answer.disclaimer}</p>
          </>
        ) : null}
        <form className="stack-lg" onSubmit={send} noValidate>
          <TextField
            label="Ask Nova a follow-up"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={!answer}
          />
          <div className="row-actions">
            <Button type="submit" disabled={!answer || explain.isPending || !question.trim()}>
              Send
            </Button>
            <Button variant="secondary" onClick={onDone}>
              Close
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
