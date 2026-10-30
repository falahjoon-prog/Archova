'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Select, StatusPill, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { companyName } from '@/shared/mocks/directory';
import { useNegotiate } from '../hooks/useQuotes';
import {
  NEGOTIATE_DISCLAIMER,
  type NegotiateAnswer,
  type NegotiateStance,
  type NegotiateTopic,
} from '../lib/negotiate';
import type { Quote } from '../lib/quote-types';
import { speak, speechSupported, stopSpeaking } from '../lib/speech';
import { money, parseDollars } from './money';

const TOPICS: ReadonlyArray<{ id: NegotiateTopic; label: string }> = [
  { id: 'overview', label: 'Read this quote' },
  { id: 'counter', label: 'Counter-offer ideas' },
  { id: 'scope', label: 'Scope gaps' },
  { id: 'message', label: 'Draft a message' },
];

const STANCE: Record<
  NegotiateStance,
  { tone: 'warning' | 'info' | 'success' | 'neutral'; label: string }
> = {
  above: { tone: 'warning', label: 'Above the reference' },
  below: { tone: 'info', label: 'Below the reference' },
  within: { tone: 'success', label: 'Close to the reference' },
  no_reference: { tone: 'neutral', label: 'No reference yet' },
};

type Clip = 'idle' | 'talking' | 'presenting';

/** Nova's clip: idle at rest, talking while Nova works, presenting when Nova has a counter-offer to show. */
function NegotiateClip({ clip }: { clip: Clip }) {
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
    <div className="negotiate__clip">
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small static poster, decorative
        <img src={`${base}.jpg`} alt="" className="negotiate__media" />
      ) : (
        <video
          key={clip}
          className="negotiate__media"
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

/** Nova helps negotiate one confirmed quote: the gap to the target or the field, points to raise, a counter to consider. */
export function NegotiatePanel({
  packageId,
  quotes,
}: {
  packageId: string;
  quotes: readonly Quote[];
}) {
  const ask = useNegotiate(packageId);
  const [quoteId, setQuoteId] = useState(quotes[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [topic, setTopic] = useState<NegotiateTopic>('overview');
  const [answer, setAnswer] = useState<NegotiateAnswer | null>(null);
  const [draft, setDraft] = useState('');
  const [readAloud, setReadAloud] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = speechSupported();
  const targetCents = parseDollars(target);
  const targetError = target.trim() !== '' && (targetCents === null || targetCents === 0);
  const selected = quotes.some((q) => q.id === quoteId) ? quoteId : (quotes[0]?.id ?? '');

  useEffect(() => stopSpeaking, []);

  const say = (text: string) => {
    setSpeaking(true);
    speak(text, () => setSpeaking(false));
  };

  // A different quote is a different conversation.
  useEffect(() => {
    stopSpeaking();
    setAnswer(null);
    ask.reset();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (next: NegotiateTopic) => {
    setTopic(next);
    ask.mutate(
      { quoteId: selected, targetCents: target.trim() === '' ? null : targetCents, topic: next },
      {
        onSuccess: (a) => {
          setAnswer(a);
          setDraft(a.draftMessage ?? '');
          if (readAloud) say(a.reply);
        },
      },
    );
  };
  const clip: Clip =
    ask.isPending || speaking ? 'talking' : answer?.counterCents ? 'presenting' : 'idle';
  const stance = answer ? STANCE[answer.stance] : null;

  return (
    <Card
      title="Nova: negotiation help"
      headingLevel={3}
      actions={<StatusPill tone="ai">AI assistant</StatusPill>}
      className="negotiate"
    >
      <div className="negotiate__layout">
        <NegotiateClip clip={clip} />
        <div className="stack negotiate__body">
          <p className="u-m-0">
            Pick a confirmed quote and Nova will set it against your target price, or the median of
            the quotes, and suggest what to raise with the subcontractor. Nova sees prices and terms
            only.
          </p>
          <div className="negotiate__controls">
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
              hint="Without one, Nova uses the median of three or more quotes."
            />
          </div>
          <div className="row-actions" role="group" aria-label="Ask Nova">
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
          {canSpeak ? (
            <div className="row-actions">
              <Checkbox
                label="Read Nova's replies aloud"
                checked={readAloud}
                onChange={(e) => {
                  setReadAloud(e.target.checked);
                  if (!e.target.checked) {
                    stopSpeaking();
                    setSpeaking(false);
                  }
                }}
              />
              {answer && !ask.isPending ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (speaking) {
                      stopSpeaking();
                      setSpeaking(false);
                    } else say(answer.reply);
                  }}
                >
                  {speaking ? 'Stop' : 'Read aloud'}
                </Button>
              ) : null}
            </div>
          ) : null}
          <ErrorAlert error={ask.error} title="Nova couldn't help with this quote" />
          <div aria-live="polite" className="stack">
            {ask.isPending ? (
              <p className="u-caption u-m-0">Nova is looking at the quote…</p>
            ) : null}
            {answer && !ask.isPending ? (
              <div className="stack negotiate__answer">
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
                  <p className="negotiate__counter u-m-0">
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
          <p className="u-caption u-m-0">{NEGOTIATE_DISCLAIMER}</p>
        </div>
      </div>
    </Card>
  );
}
