'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addDays, parseLocalDate } from '@archova/time';
import { Alert, Button, CitationChip, buttonClassName, NovaFeedback, Textarea } from '@archova/ui';
import { NovaIcon, X } from '@archova/ui/icons';
import { AppLink } from '@/shared/layout/AppLink';
import { resolveCitation } from '@/shared/lib/citations';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { askNova, sendAnswerFeedback } from '../data/ask';
import { actionRedirect } from '../data/actions';
import { startersFor } from '../data/starters';
import { errorHelpAnswer, navHelpAnswer } from '../data/help';
import type { ErrorView } from '@/shared/lib/errors';
import { previewAnswer, streamText, type NovaAnswer } from '../data/preview-answers';
import { AI_USAGE_KEY, useAiUsage } from '../hooks/useAiUsage';
import {
  useAssistantPanelState,
  useAssistantScope,
  useRunAssistantAction,
  type AssistantScope,
} from './AssistantScope';

interface Turn {
  id: number;
  question: string;
  scope: AssistantScope;
  context: string[];
  status: 'thinking' | 'streaming' | 'done' | 'stopped' | 'error';
  answer: NovaAnswer | null;
  shown: string;
  feedback: 'up' | 'down' | null;
  /** Set when the person asked Nova about an error; the answer explains it and suggests what to do. */
  error?: ErrorView;
}

const RECORD_LABELS: Record<string, string> = {
  rfi: 'This RFI',
  rfis: 'RFI register',
  defect: 'This defect',
  defects: 'Defects register',
  diary: 'Site diary',
  documents: 'Documents',
  drawing: 'This drawing',
  'tender-package': 'This tender package',
  'tender-packages': 'Tender packages',
};

function recordLabel(r: NonNullable<AssistantScope['record']>): string {
  if (r.label) return r.label;
  if (r.type === 'diary' && /^\d{4}-\d{2}-\d{2}$/.test(r.id))
    return `Diary ${formatLocalDate(r.id)}`;
  return RECORD_LABELS[r.type] ?? 'This page';
}

/** Starters that work with what Nova can read: the preview's records, or what the project holds (documents, drawings, RFIs, defects, the site diary). */
const SUGGESTIONS = previewDataOnly
  ? [
      'Which RFIs are overdue?',
      'Which defects are ready for inspection?',
      'How many wet days have we had this month?',
    ]
  : [
      'What fire rating do the stair walls need?',
      'Which RFIs are still waiting on an answer?',
      'Which defects are open in the bathrooms?',
    ];

/** "allowance resets on 1 Nov 2026": a month after the period start. */
function resetDate(periodStart: string): string {
  const { year, month } = parseLocalDate(periodStart);
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return formatLocalDate(addDays(next, 0));
}

/**
 * The Ask Nova panel (frontend 02 §7.1, design 02 §7.7): context chips the person can remove, streamed answers with
 * citations, stop and retry, copy, thumbs up/down, "not found" as its own state, and the allowance state when the
 * org's monthly credits are used up. Answers never act on their own.
 */
export function AssistantPanel() {
  const org = useCurrentOrg();
  const scope = useAssistantScope();
  const panel = useAssistantPanelState();
  const usage = useAiUsage();
  const qc = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [dropped, setDropped] = useState<{ record: boolean; project: boolean }>({
    record: false,
    project: false,
  });
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const scopeKey = JSON.stringify(scope);

  // A new screen brings its own context back.
  useEffect(() => setDropped({ record: false, project: false }), [scopeKey]);
  // "Ask Nova about this" and opening the panel put the cursor in the box.
  useEffect(() => {
    if (panel.open) input.current?.focus();
  }, [panel.open, panel.focusRequest]);

  const effective: AssistantScope = {
    ...(scope.projectId && !dropped.project
      ? { projectId: scope.projectId, projectName: scope.projectName, timezone: scope.timezone }
      : {}),
    ...(scope.record && !dropped.record && !dropped.project ? { record: scope.record } : {}),
    ...(scope.counts && !dropped.project ? { counts: scope.counts } : {}),
  };
  const starters = startersFor(
    scope.record && dropped.record ? { ...scope, record: undefined } : scope,
    org.orgSlug,
  );
  const questions = starters.questions.length ? starters.questions : SUGGESTIONS;
  const chips = [
    ...(effective.projectId
      ? [{ key: 'project' as const, label: effective.projectName ?? 'This project' }]
      : []),
    ...(effective.record ? [{ key: 'record' as const, label: recordLabel(effective.record) }] : []),
  ];

  const exhausted = usage.data?.remaining === 0;
  const busy = turns.some((t) => t.status === 'thinking' || t.status === 'streaming');

  const update = (id: number, patch: Partial<Turn>) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const run = async (id: number, question: string, s: AssistantScope, error?: ErrorView) => {
    const controller = new AbortController();
    abort.current = controller;
    update(id, { status: 'thinking', shown: '', answer: null, feedback: null });
    try {
      // Without a project there is nothing to search; the preview answers from the screens' own data.
      const answer =
        (error ? errorHelpAnswer(error) : null) ??
        actionRedirect(question, s) ??
        navHelpAnswer(question) ??
        (previewDataOnly || !s.projectId
          ? await previewAnswer(
              question,
              s,
              todayIn(s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
            )
          : await askNova(org.orgId, s.projectId, question, controller.signal));
      if (answer.runId) void qc.invalidateQueries({ queryKey: AI_USAGE_KEY(org.orgId) });
      if (controller.signal.aborted) return update(id, { status: 'stopped' });
      update(id, { status: 'streaming', answer });
      const end = await streamText(
        answer.text,
        (shown) => update(id, { shown }),
        controller.signal,
      );
      update(id, { status: end === 'done' ? 'done' : 'stopped' });
    } catch {
      update(id, { status: 'error' });
    }
  };

  const ask = (question: string, error?: ErrorView) => {
    const q = question.trim();
    if (!q || busy || exhausted) return;
    const id = nextId.current++;
    const turn: Turn = {
      id,
      question: q,
      scope: effective,
      context: chips.map((c) => c.label),
      status: 'thinking',
      answer: null,
      shown: '',
      feedback: null,
      ...(error ? { error } : {}),
    };
    setTurns((ts) => [...ts, turn]);
    setDraft('');
    void run(id, q, effective, error);
  };

  // "Ask Nova what to do" on an error alert: explain it and suggest a fix, once per click.
  const pendingError = panel.pendingError;
  useEffect(() => {
    if (!pendingError || busy) return;
    panel.clearPendingError();
    ask(
      `What went wrong${pendingError.status ? ` (error ${pendingError.status})` : ''}, and what should I do?`,
      pendingError,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingError]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };

  return (
    <div className="assistant-panel stack">
      <div className="row-actions assistant-panel__head">
        <h2 className="assistant-panel__title">
          <NovaIcon size={18} aria-hidden="true" /> Ask Nova
        </h2>
        <Button
          variant="tertiary"
          size="sm"
          iconOnly
          aria-label="Close Ask Nova"
          onClick={() => panel.setOpen(false)}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </div>

      {usage.data && usage.data.allowance !== null && !exhausted ? (
        <p className="u-caption u-m-0">
          {Math.round(usage.data.used)} of {usage.data.allowance} credits used this month.
        </p>
      ) : null}
      {exhausted && usage.data ? (
        <Alert tone="warning" title="Nova's allowance is used for this month">
          An admin can top up, or it resets on {resetDate(usage.data.periodStart)}. Everything else
          keeps working, and drawings and documents are still read in the background.
        </Alert>
      ) : null}

      <ol
        className="assistant-panel__turns plain-list"
        aria-label="Conversation"
        aria-live="polite"
      >
        {turns.map((t) => (
          <li key={t.id} className="stack">
            <p className="assistant-panel__question u-m-0">{t.question}</p>
            {t.context.length ? (
              <p className="u-caption u-m-0">About: {t.context.join(', ')}</p>
            ) : null}
            <AnswerBlock
              turn={t}
              orgSlug={org.orgSlug}
              onStop={() => abort.current?.abort()}
              onRetry={() => void run(t.id, t.question, t.scope, t.error)}
              onFeedback={(v) => {
                update(t.id, { feedback: v });
                // Only answers the API produced can be rated; the preview's are kept on screen.
                if (t.answer?.runId)
                  void sendAnswerFeedback(org.orgId, t.answer.runId, v).catch(() => {});
              }}
            />
          </li>
        ))}
      </ol>

      {turns.length === 0 ? (
        <div className="stack">
          <p className="u-muted u-m-0">
            Ask about this project. Answers link to the drawings and records they come from, and
            only use what you can see.
          </p>
          <ul className="plain-list stack" aria-label="Suggested questions">
            {questions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="link-button"
                  disabled={exhausted}
                  onClick={() => ask(s)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
          {starters.actions.length ? (
            <ul className="row-actions plain-list" aria-label="Quick actions">
              {starters.actions.map((a) => (
                <li key={a.key}>
                  <AppLink className={buttonClassName('secondary', 'ac-button--sm')} href={a.href}>
                    {a.label}
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form className="stack assistant-panel__form" onSubmit={submit}>
        {chips.length ? (
          <ul className="row-actions plain-list" aria-label="Answering about">
            {chips.map((c) => (
              <li key={c.key} className="assistant-chip">
                {c.label}
                <button
                  type="button"
                  className="assistant-chip__remove"
                  aria-label={`Remove ${c.label}`}
                  onClick={() => setDropped((d) => ({ ...d, [c.key]: true }))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Textarea
          ref={input}
          label="Question"
          rows={2}
          value={draft}
          disabled={exhausted}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        <div>
          <Button type="submit" variant="nova" disabled={!draft.trim() || busy || exhausted}>
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}

function AnswerBlock({
  turn,
  orgSlug,
  onStop,
  onRetry,
  onFeedback,
}: {
  turn: Turn;
  orgSlug: string;
  onStop: () => void;
  onRetry: () => void;
  onFeedback: (v: 'up' | 'down') => void;
}) {
  const [copied, setCopied] = useState(false);
  const runAction = useRunAssistantAction();
  if (turn.status === 'thinking') {
    return (
      <div className="row-actions">
        <span className="u-muted" role="status">
          Nova is looking…
        </span>
        <Button size="sm" variant="tertiary" onClick={onStop}>
          Stop
        </Button>
      </div>
    );
  }
  if (turn.status === 'error') {
    return (
      <Alert
        tone="danger"
        title="Nova couldn't answer just now"
        action={
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        Nothing else is affected. Try again in a moment.
      </Alert>
    );
  }
  const a = turn.answer;
  const projectId = turn.scope.projectId ?? '';
  return (
    <section
      className={
        a?.kind === 'not_found'
          ? 'assistant-answer assistant-answer--not-found'
          : 'ac-nova assistant-answer'
      }
      aria-label={a?.kind === 'not_found' ? 'Not found' : 'Answer from Nova'}
    >
      <p className="ac-nova__label u-m-0">
        <NovaIcon size={14} aria-hidden="true" /> {a?.kind === 'not_found' ? 'Not found' : 'Nova'}
      </p>
      <p className="u-m-0">{turn.shown}</p>
      {turn.status === 'done' && a?.action ? (
        <div className="row-actions">
          <Button size="sm" onClick={() => runAction(a.action!.id)}>
            {a.action.label}
          </Button>
        </div>
      ) : null}
      {turn.status === 'done' && a?.kind === 'not_found' && a.citations.length ? (
        <p className="u-caption u-m-0">Closest matches, so you can check yourself:</p>
      ) : null}
      {turn.status === 'done' && a && a.citations.length ? (
        <ul
          className="ac-nova__source-list"
          aria-label={a.kind === 'not_found' ? 'Closest matches' : 'Sources'}
        >
          {a.citations.map((c) => (
            <li key={c.id}>
              <CitationChip citation={resolveCitation(c, orgSlug, projectId)} linkAs={AppLink} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row-actions">
        {turn.status === 'streaming' ? (
          <Button size="sm" variant="tertiary" onClick={onStop}>
            Stop
          </Button>
        ) : null}
        {turn.status === 'stopped' ? (
          <>
            <span className="u-caption">Stopped.</span>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </>
        ) : null}
        {turn.status === 'done' ? (
          <>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                void navigator.clipboard?.writeText(turn.shown);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <NovaFeedback value={turn.feedback} onChange={onFeedback} />
          </>
        ) : null}
      </div>
    </section>
  );
}
