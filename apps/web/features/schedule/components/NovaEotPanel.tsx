'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, StatusPill, TextField } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import type { DelayEvent, DelayEventInsights } from '../data/eot';
import { FLAG_LABELS, SEVERITY_TONE, answerQuestion, type Answer } from '../lib/eot';

const EXAMPLES = [
  "What's due?",
  "What's not in an event?",
  'How many days are claimed?',
  'Which events have no evidence?',
];

/**
 * Nova on the EOT board. The flags are found by rules from the contract periods a person entered, so they cost
 * nothing and are always on. Nova flags and drafts; giving notice and sending a claim stay with people.
 */
export function NovaEotPanel({
  insights,
  events,
  onOpen,
}: {
  insights: DelayEventInsights | undefined;
  events: readonly DelayEvent[];
  onOpen: (eventId: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<(Answer & { q: string }) | null>(null);
  const flags = insights?.flags ?? [];
  const known = new Set(events.map((e) => e.id));

  function ask(q: string) {
    const text = q.trim();
    if (!text || !insights) return;
    setAnswer({ q: text, ...answerQuestion(text, { events, insights }) });
    setQuestion('');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    ask(question);
  }

  return (
    <Card>
      <section aria-labelledby="nova-eot-title" className="ac-nova eot-nova">
        <h2 id="nova-eot-title" className="ac-nova__label">
          <NovaIcon size={14} /> Nova on delays and EOT claims
        </h2>
        <p className="u-m-0 u-caption">
          Dates come from the notice and claim periods you entered, found by the checks, not by AI.
          Nova drafts letters for you to send. It never says an extension is due.
        </p>
        {flags.length === 0 && insights ? (
          <p className="u-m-0">Nothing needs attention right now.</p>
        ) : null}
        <ul className="eot-flags">
          {flags.slice(0, 8).map((f, i) => (
            <li key={`${f.eventId ?? 'none'}-${f.kind}-${i}`} className="eot-flag">
              <StatusPill tone={SEVERITY_TONE[f.severity]}>{FLAG_LABELS[f.kind]}</StatusPill>
              <span className="eot-flag__text">{f.message}</span>
              {f.eventId && known.has(f.eventId) ? (
                <Button size="sm" variant="secondary" onClick={() => onOpen(f.eventId!)}>
                  Open
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {flags.length > 8 ? <p className="u-m-0 u-caption">And {flags.length - 8} more.</p> : null}

        <form className="eot-ask" onSubmit={submit}>
          <TextField
            label="Ask Nova about delays and claims"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            hint="For example: what is due, what is not in an event, how many days are claimed."
          />
          <Button type="submit" variant="secondary" disabled={!question.trim()}>
            Ask
          </Button>
        </form>
        <ul className="eot-chips" aria-label="Example questions">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <Button size="sm" variant="tertiary" onClick={() => ask(q)}>
                {q}
              </Button>
            </li>
          ))}
        </ul>
        {answer ? (
          <div className="eot-answer" role="status">
            <p className="u-m-0 u-caption">You asked: {answer.q}</p>
            <p className="ac-nova__body u-m-0">{answer.text}</p>
            {answer.eventIds.length === 1 ? (
              <div>
                <Button size="sm" variant="secondary" onClick={() => onOpen(answer.eventIds[0]!)}>
                  Open it
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
