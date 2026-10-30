'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Select, StatusPill, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { companyName } from '@/shared/mocks/directory';
import { useElena } from '../hooks/useQuotes';
import {
  ELENA_DISCLAIMER,
  type ElenaAnswer,
  type ElenaStance,
  type ElenaTopic,
} from '../lib/elena';
import type { Quote } from '../lib/quote-types';
import { money, parseDollars } from './money';

const TOPICS: ReadonlyArray<{ id: ElenaTopic; label: string }> = [
  { id: 'overview', label: 'Read this quote' },
  { id: 'counter', label: 'Counter-offer ideas' },
  { id: 'scope', label: 'Scope gaps' },
  { id: 'message', label: 'Draft a message' },
];

const STANCE: Record<
  ElenaStance,
  { tone: 'warning' | 'info' | 'success' | 'neutral'; label: string }
> = {
  above: { tone: 'warning', label: 'Above the reference' },
  below: { tone: 'info', label: 'Below the reference' },
  within: { tone: 'success', label: 'Close to the reference' },
  no_reference: { tone: 'neutral', label: 'No reference yet' },
};

type Clip = 'idle' | 'talking' | 'presenting';

/** Elena's clip: idle at rest, talking while she works, presenting when she has a counter-offer to show. */
function ElenaClip({ clip }: { clip: Clip }) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!q) return;
    setStill(q.matches);
    const on = () => setStill(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  const base = `/elena/elena-video-${clip}`;
  return (
    <div className="elena__clip">
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small static poster, decorative
        <img src={`${base}.jpg`} alt="" className="elena__media" />
      ) : (
        <video
          key={clip}
          className="elena__media"
          poster={`${base}.jpg`}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        >
          <source src={`${base}.webm`} type="video/webm" />
          <source src={`${base}.mp4`} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

/** Elena helps negotiate one confirmed quote: the gap to the target or the field, points to raise, a counter to consider. */
export function ElenaPanel({ packageId, quotes }: { packageId: string; quotes: readonly Quote[] }) {
  const ask = useElena(packageId);
  const [quoteId, setQuoteId] = useState(quotes[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [topic, setTopic] = useState<ElenaTopic>('overview');
  const [answer, setAnswer] = useState<ElenaAnswer | null>(null);
  const [draft, setDraft] = useState('');
  const targetCents = parseDollars(target);
  const targetError = target.trim() !== '' && (targetCents === null || targetCents === 0);
  const selected = quotes.some((q) => q.id === quoteId) ? quoteId : (quotes[0]?.id ?? '');

  // A different quote is a different conversation.
  useEffect(() => {
    setAnswer(null);
    ask.reset();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (next: ElenaTopic) => {
    setTopic(next);
    ask.mutate(
      { quoteId: selected, targetCents: target.trim() === '' ? null : targetCents, topic: next },
      {
        onSuccess: (a) => {
          setAnswer(a);
          setDraft(a.draftMessage ?? '');
        },
      },
    );
  };
  const clip: Clip = ask.isPending ? 'talking' : answer?.counterCents ? 'presenting' : 'idle';
  const stance = answer ? STANCE[answer.stance] : null;

  return (
    <Card
      title="Elena: negotiation help"
      headingLevel={3}
      actions={<StatusPill tone="ai">AI assistant</StatusPill>}
      className="elena"
    >
      <div className="elena__layout">
        <ElenaClip clip={clip} />
        <div className="stack elena__body">
          <p className="u-m-0">
            Pick a confirmed quote and Elena will set it against your target price, or the median of
            the quotes, and suggest what to raise with the subcontractor. She sees prices and terms
            only.
          </p>
          <div className="elena__controls">
            <Select
              label="Quote"
              value={selected}
              onChange={(e) => setQuoteId(e.target.value)}
              options={quotes.map((q) => ({
                value: q.id,
                label: `${companyName(q.companyId)} (${q.reference})`,
              }))}
            />
            <TextField
              label="Target price, ex GST (optional)"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              error={targetError ? 'Enter an amount above zero, like 45000' : undefined}
              hint="Without one, Elena uses the median of three or more quotes."
            />
          </div>
          <div className="row-actions" role="group" aria-label="Ask Elena">
            {TOPICS.map((t) => (
              <Button
                key={t.id}
                variant={t.id === 'overview' ? 'primary' : 'secondary'}
                disabled={ask.isPending || targetError || !selected}
                onClick={() => run(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <ErrorAlert error={ask.error} title="Elena couldn't help with this quote" />
          <div aria-live="polite" className="stack">
            {ask.isPending ? (
              <p className="u-caption u-m-0">Elena is looking at the quote…</p>
            ) : null}
            {answer && !ask.isPending ? (
              <div className="stack elena__answer">
                {stance ? <StatusPill tone={stance.tone}>{stance.label}</StatusPill> : null}
                <p className="u-m-0">{answer.reply}</p>
                {answer.points.length ? (
                  <ul className="plain-list">
                    {answer.points.map((p, i) => (
                      <li key={i}>{p.text}</li>
                    ))}
                  </ul>
                ) : null}
                {answer.levers.length ? (
                  <ul className="plain-list">
                    {answer.levers.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : null}
                {answer.counterCents ? (
                  <p className="elena__counter u-m-0">
                    <strong>Counter-offer to consider: {money(answer.counterCents)} ex GST.</strong>{' '}
                    {answer.counterReason}
                  </p>
                ) : topic === 'counter' ? (
                  <p className="u-m-0">
                    There is no counter-offer to suggest: the quote isn't above its reference.
                  </p>
                ) : null}
                {answer.draftMessage ? (
                  <Textarea
                    label="Draft message to the subcontractor (edit before you send it)"
                    rows={7}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    hint="Nothing is sent from here."
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="u-caption u-m-0">{ELENA_DISCLAIMER}</p>
        </div>
      </div>
    </Card>
  );
}
