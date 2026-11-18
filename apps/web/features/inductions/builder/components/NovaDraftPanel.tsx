'use client';

import { useState } from 'react';
import { Alert, Button, Card, TextField } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { useRegisterAssistantAction } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useInductionRefresh } from '../hooks/useBuilder';
import { parseDraft, type AiSuggestion, type ParsedRefresh } from '../lib/refresh';
import { SECTION_LABELS } from '../lib/types';

/**
 * Nova drafts the whole induction from the project's documents (F33 I1): slides, script and quiz, every point
 * cited. Like every Nova result it is a suggestion until the builder takes it into the draft, then saves it and
 * approves each section (P6, IND-AC13).
 */
export function NovaDraftPanel({
  hasContent,
  disabled,
  pending,
  onPending,
  onTake,
}: {
  /** The draft already has sections that taking Nova's in would replace. */
  hasContent: boolean;
  disabled: boolean;
  pending: AiSuggestion | null;
  onPending: (s: AiSuggestion | null) => void;
  onTake: (r: ParsedRefresh) => void;
}) {
  const project = useCurrentProject();
  const nova = useInductionRefresh();
  const [siteName, setSiteName] = useState(project.name);
  // Ask Nova's "Draft with Nova" button runs the same draft as this page's button, so both stay in step.
  useRegisterAssistantAction('draft', () => {
    if (!disabled && !nova.draft.isPending && !pending && siteName.trim()) {
      nova.draft.mutate(siteName, { onSuccess: onPending });
    }
  });
  const parsed = pending ? parseDraft(pending) : null;
  const warnings =
    (pending?.payload as { warnings?: unknown[] } | undefined)?.warnings?.length ?? 0;

  return (
    <Card title="Draft this induction with Nova">
      {!parsed ? (
        <div className="stack">
          <p className="u-m-0 u-muted">
            Nova reads the project documents you can open and drafts slides, a script and a quiz,
            citing the source of every point. Sections the documents don't cover are left for you to
            add. Uses 3 Nova credits. Nothing changes until you take it in.
          </p>
          <div className="row-end">
            <TextField
              label="Site name"
              value={siteName}
              disabled={disabled || nova.draft.isPending}
              onChange={(e) => setSiteName(e.target.value)}
            />
            <Button
              variant="nova"
              disabled={disabled || nova.draft.isPending || !siteName.trim()}
              onClick={() => nova.draft.mutate(siteName, { onSuccess: onPending })}
            >
              <NovaIcon size={16} aria-hidden="true" />
              {nova.draft.isPending ? 'Nova is drafting…' : 'Draft with Nova'}
            </Button>
          </div>
          <ErrorAlert error={nova.draft.error} title="Nova couldn't draft the induction" />
        </div>
      ) : (
        <Alert tone="info" title="Nova's draft is ready">
          <div className="stack">
            <p className="u-m-0">
              Covered:{' '}
              {parsed.redrafted.map((s) => SECTION_LABELS[s.key]).join(', ') || 'no sections'}
              {parsed.quiz.length ? `, with ${parsed.quiz.length} quiz questions` : ''}.
              {hasContent ? ' Taking it in replaces the sections and quiz you have now.' : ''}
            </p>
            {warnings ? (
              <p className="u-m-0">
                Nova removed or flagged {warnings} {warnings === 1 ? 'point' : 'points'} it couldn't
                check against the documents. Read every section before you approve it.
              </p>
            ) : null}
            {parsed.missing.map((m) => (
              <p key={m.key} className="u-m-0">
                <strong>{SECTION_LABELS[m.key]}</strong> isn't covered. {m.gap}
              </p>
            ))}
            <div className="row-actions">
              <Button
                disabled={disabled || parsed.redrafted.length === 0}
                onClick={() => onTake(parsed)}
              >
                Take Nova's draft into the editor
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  nova.decide.mutate({ suggestionId: parsed.suggestionId, decision: 'rejected' });
                  onPending(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Alert>
      )}
    </Card>
  );
}
