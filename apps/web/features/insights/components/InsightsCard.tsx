'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, SkeletonRows, StatusPill, Textarea } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { toErrorView } from '@/shared/lib/errors';
import type { InsightKind, InsightTurn, ProjectInsight } from '../data/api';
import { useDiscussInsight, useProjectInsights } from '../hooks/useInsights';

const SEVERITY = {
  high: { tone: 'danger', label: 'High' },
  medium: { tone: 'warning', label: 'Medium' },
  low: { tone: 'info', label: 'Low' },
} as const;

/** The earlier turns Nova is sent back, so it remembers the conversation (the server keeps none). */
const HISTORY_TURNS = 8;

interface Exchange {
  question: string;
  focus: InsightKind | null;
  answer?: { text: string; grounded: boolean; suggestions: string[] };
  failed?: boolean;
}

const STARTERS = [
  'What should I look at first?',
  'Why does this matter?',
  'Suggest options to fix this',
];

/**
 * Project home: ranked notes from fixed rules (budget, overdue items, programme slip) with an "Ask Nova" thread under
 * them. Nova explains, compares and proposes options; it only suggests, so nothing here changes a record.
 */
export function InsightsCard({ projectId }: { projectId: string }) {
  const insights = useProjectInsights(projectId);
  const discuss = useDiscussInsight(projectId);
  const [focus, setFocus] = useState<InsightKind | null>(null);
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<Exchange[]>([]);

  const notes = insights.data?.insights ?? [];
  const focused = notes.find((n) => n.id === focus) ?? null;

  function ask(text: string) {
    const question = text.trim();
    if (!question || discuss.isPending) return;
    const history: InsightTurn[] = thread
      .flatMap((t): InsightTurn[] =>
        t.answer
          ? [
              { role: 'user', text: t.question },
              { role: 'nova', text: t.answer.text },
            ]
          : [],
      )
      .slice(-HISTORY_TURNS);
    const index = thread.length;
    setThread((t) => [...t, { question, focus }]);
    setDraft('');
    discuss.mutate(
      { question, ...(focus ? { insightId: focus } : {}), history },
      {
        onSuccess: (r) =>
          setThread((t) =>
            t.map((x, i) =>
              i === index
                ? {
                    ...x,
                    answer: { text: r.answer, grounded: r.grounded, suggestions: r.suggestions },
                  }
                : x,
            ),
          ),
        onError: () =>
          setThread((t) => t.map((x, i) => (i === index ? { ...x, failed: true } : x))),
      },
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    ask(draft);
  }

  // Insights are staff-only; the API refuses everyone else, and for them the card is simply absent.
  if (insights.isError && toErrorView(insights.error).status === 403) return null;

  return (
    <Card
      title={
        <span className="insights__title">
          <NovaIcon size={16} aria-hidden="true" /> Insights
        </span>
      }
      className="insights"
    >
      <p className="insights__lede u-caption">Actionable insights from Nova</p>
      <ErrorAlert error={insights.error} title="We couldn't load the insights" />
      {insights.isPending ? <SkeletonRows rows={3} label="Loading insights…" /> : null}
      {insights.data && notes.length === 0 ? (
        <p className="insights__empty">
          Nothing needs attention right now. Budget, overdue items and the programme are all on
          track.
        </p>
      ) : null}
      {notes.length ? (
        <ul className="insights__list plain-list">
          {notes.map((n) => (
            <InsightRow
              key={n.id}
              note={n}
              selected={n.id === focus}
              onAsk={() => setFocus((f) => (f === n.id ? null : n.id))}
            />
          ))}
        </ul>
      ) : null}

      {notes.length ? (
        <section className="insights__chat" aria-label="Ask Nova about these insights">
          <p className="insights__scope u-caption" aria-live="polite">
            {focused ? `Asking about: ${focused.title}` : 'Asking about all insights'}
          </p>
          {thread.length ? (
            <ol className="insights__thread plain-list" aria-label="Conversation with Nova">
              {thread.map((t, i) => (
                <li key={i} className="insights__turn">
                  <p className="insights__question">{t.question}</p>
                  {t.answer ? (
                    <div className="insights__answer">
                      <p className="ac-nova__label">
                        <NovaIcon size={14} aria-hidden="true" /> Nova
                      </p>
                      <p className="u-m-0">{t.answer.text}</p>
                      {t.answer.suggestions.length ? (
                        <>
                          <p className="ac-caption u-m-0">Options for you to review</p>
                          <ul className="insights__options">
                            {t.answer.suggestions.map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      <p className="ac-caption u-m-0">
                        Nova only suggests. Nothing has been changed.
                      </p>
                    </div>
                  ) : t.failed ? (
                    <Alert tone="danger">Nova couldn&apos;t answer this. Try again.</Alert>
                  ) : (
                    <SkeletonRows rows={2} label="Nova is thinking…" />
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <ul className="insights__starters plain-list" aria-label="Suggested questions">
              {STARTERS.map((s) => (
                <li key={s}>
                  <Button variant="secondary" onClick={() => ask(s)} disabled={discuss.isPending}>
                    {s}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form className="insights__form" onSubmit={submit}>
            <Textarea
              label="Ask Nova"
              rows={2}
              value={draft}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
            />
            <Button type="submit" variant="nova" disabled={!draft.trim() || discuss.isPending}>
              Ask
            </Button>
          </form>
        </section>
      ) : null}
    </Card>
  );
}

function InsightRow({
  note,
  selected,
  onAsk,
}: {
  note: ProjectInsight;
  selected: boolean;
  onAsk: () => void;
}) {
  const sev = SEVERITY[note.severity];
  return (
    <li className="insights__item" data-selected={selected || undefined}>
      <div className="insights__item-head">
        <StatusPill tone={sev.tone}>{sev.label}</StatusPill>
        <b className="insights__item-title">{note.title}</b>
      </div>
      <p className="insights__item-detail u-m-0">{note.detail}</p>
      <Button variant="secondary" aria-pressed={selected} onClick={onAsk}>
        {selected ? 'Asking about this' : 'Ask Nova about this'}
      </Button>
    </li>
  );
}
