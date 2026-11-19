'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, StatusPill, TextField } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import type { Insights, Unit } from '../data/api';
import { FLAG_LABELS, SEVERITY_TONE, answerQuestion, type Answer } from '../lib/units';

const EXAMPLES = [
  "What's late?",
  "What's on QA hold?",
  'What installs next?',
  'Are deliveries booked?',
];

/**
 * Nova on the prefab board. The flags are found by rules, so they cost nothing and are always on. Questions are
 * answered straight from the board. Nova flags and suggests; moving a unit stays with people.
 */
export function NovaPrefabPanel({
  insights,
  units,
  onOpen,
}: {
  insights: Insights | undefined;
  units: readonly Unit[];
  onOpen: (unitId: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<(Answer & { q: string }) | null>(null);
  const flags = insights?.flags ?? [];
  const byId = new Map(units.map((u) => [u.id, u]));

  function ask(q: string) {
    const text = q.trim();
    if (!text || !insights) return;
    setAnswer({ q: text, ...answerQuestion(text, { units, flags, today: insights.today }) });
    setQuestion('');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    ask(question);
  }

  return (
    <Card>
      <section aria-labelledby="nova-prefab-title" className="ac-nova pfb-nova">
        <h2 id="nova-prefab-title" className="ac-nova__label">
          <NovaIcon size={14} /> Nova on the prefab board
        </h2>
        <p className="u-m-0 u-caption">Found by the checks, not by AI.</p>
        {flags.length === 0 && insights ? (
          <p className="u-m-0">Nothing needs attention right now.</p>
        ) : null}
        <ul className="pfb-flags">
          {flags.slice(0, 8).map((f) => (
            <li key={`${f.unitId}-${f.kind}`} className="pfb-flag">
              <StatusPill className="pfb-pill" tone={SEVERITY_TONE[f.severity]}>
                {FLAG_LABELS[f.kind]}
              </StatusPill>
              <span className="pfb-flag__text">{f.message}</span>
              {byId.has(f.unitId) ? (
                <Button size="sm" variant="secondary" onClick={() => onOpen(f.unitId)}>
                  Open
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {flags.length > 8 ? <p className="u-m-0 u-caption">And {flags.length - 8} more.</p> : null}

        <form className="pfb-ask" onSubmit={submit}>
          <TextField
            label="Ask Nova about the units"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            hint="For example: what is late, what is on QA hold, what installs next."
          />
          <Button type="submit" variant="secondary" disabled={!question.trim()}>
            Ask
          </Button>
        </form>
        <ul className="pfb-chips" aria-label="Example questions">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <Button size="sm" variant="tertiary" onClick={() => ask(q)}>
                {q}
              </Button>
            </li>
          ))}
        </ul>
        {answer ? (
          <div className="pfb-answer" role="status">
            <p className="u-m-0 u-caption">You asked: {answer.q}</p>
            <p className="ac-nova__body u-m-0">{answer.text}</p>
            {answer.unitIds.length === 1 ? (
              <div>
                <Button size="sm" variant="secondary" onClick={() => onOpen(answer.unitIds[0]!)}>
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
