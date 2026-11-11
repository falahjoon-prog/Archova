'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, StatusPill, TextField } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import type { Delivery, DeliveryFlag, DeliveryInsights, Resource } from '../data/api';
import { answerQuestion, type Answer } from '../lib/board';

const SEVERITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;
const KIND_LABEL: Record<DeliveryFlag['kind'], string> = {
  late: 'Late',
  overdue: 'Overdue',
  arrived_late: 'Arrived late',
  double_booked: 'Dock clash',
  lift_clash: 'Crane clash',
  no_plan: 'No plan',
};
const EXAMPLES = [
  "What's late?",
  'Any clashes?',
  "What's coming tomorrow?",
  'When is the crane free?',
];

/**
 * Nova on the delivery board. The flags are found by rules, so they cost nothing and are always on. Each one comes
 * with the next step (find another slot, chase the supplier) and the questions Nova answers are read straight off
 * the board. Nova suggests and drafts; booking and sending stay with people.
 */
export function NovaBoardPanel({
  insights,
  deliveries,
  resources,
  tz,
  canManage,
  onOpen,
}: {
  insights: DeliveryInsights | undefined;
  deliveries: readonly Delivery[];
  resources: readonly Resource[];
  tz: string;
  canManage: boolean;
  onOpen: (deliveryId: string, panel: 'reschedule' | 'notice' | null) => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<(Answer & { q: string }) | null>(null);
  const flags = insights?.flags ?? [];

  function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setAnswer({
      q: text,
      ...answerQuestion(text, { deliveries, resources, flags, tz, now: new Date() }),
    });
    setQuestion('');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    ask(question);
  }

  const c = insights?.counts;
  return (
    <Card>
      <section aria-labelledby="nova-deliveries-title" className="ac-nova dlv-nova">
        <h2 id="nova-deliveries-title" className="ac-nova__label">
          <NovaIcon size={14} /> Nova on the delivery board
        </h2>
        {c ? (
          <p className="u-m-0 u-caption">
            {c.today} today · {c.arrivedToday} here · {c.late} late · {c.clashes} clashing ·{' '}
            {c.noPlan} with no plan. Found by the checks, not by AI.
          </p>
        ) : null}
        {flags.length === 0 && insights ? (
          <p className="u-m-0">Nothing needs attention right now.</p>
        ) : null}
        <ul className="dlv-flags">
          {flags.slice(0, 8).map((f) => (
            <li key={`${f.deliveryId}-${f.kind}`} className="dlv-flag">
              <StatusPill tone={SEVERITY_TONE[f.severity]}>{KIND_LABEL[f.kind]}</StatusPill>
              <span className="dlv-flag__text">{f.message}</span>
              <span className="dlv-flag__actions">
                <Button size="sm" variant="secondary" onClick={() => onOpen(f.deliveryId, null)}>
                  Open
                </Button>
                {canManage &&
                (f.kind === 'double_booked' ||
                  f.kind === 'lift_clash' ||
                  f.kind === 'overdue' ||
                  f.kind === 'no_plan') ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onOpen(f.deliveryId, 'reschedule')}
                  >
                    Find another slot
                  </Button>
                ) : null}
                {canManage && (f.kind === 'late' || f.kind === 'overdue') ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onOpen(f.deliveryId, 'notice')}
                  >
                    Draft chase note
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {flags.length > 8 ? <p className="u-m-0 u-caption">And {flags.length - 8} more.</p> : null}

        <form className="dlv-ask" onSubmit={submit}>
          <TextField
            label="Ask Nova about the deliveries"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            hint="For example: what is late, who is bringing steel, when is the crane free."
          />
          <Button type="submit" variant="secondary" disabled={!question.trim()}>
            Ask
          </Button>
        </form>
        <ul className="dlv-chips" aria-label="Example questions">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <Button size="sm" variant="tertiary" onClick={() => ask(q)}>
                {q}
              </Button>
            </li>
          ))}
        </ul>
        {answer ? (
          <div className="dlv-answer" role="status">
            <p className="u-m-0 u-caption">You asked: {answer.q}</p>
            <p className="ac-nova__body u-m-0">{answer.text}</p>
            {answer.deliveryIds.length === 1 ? (
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpen(answer.deliveryIds[0]!, null)}
                >
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
