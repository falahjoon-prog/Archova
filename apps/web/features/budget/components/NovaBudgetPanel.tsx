'use client';

import { useState } from 'react';
import { Alert, Button, Card, StatusPill, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetFinding, BudgetReviewAdvice } from '../data/api';
import { useAskNovaBudget, useReviewChecks } from '../hooks/useBudget';

const KIND_LABEL: Record<BudgetFinding['kind'], string> = {
  over_committed: 'Over committed',
  over_spent: 'Over spent',
  unbudgeted: 'No budget',
  near_limit: 'Near the limit',
  large_change: 'Large change',
};

const OPTION_LABEL: Record<BudgetReviewAdvice['options'][number]['kind'], string> = {
  adjust_budget: 'Adjust the budget',
  reallocate: 'Move budget from another line',
  review_commitment: 'Review the commitment',
  check_costs: 'Check the recorded costs',
  raise_variation: 'Raise a variation',
  get_forecast: 'Get a cost to complete',
  no_action: 'No action needed',
};

/**
 * The budget checks (found by code, free) and Nova's help with them: what they mean, ways to deal with each, and a
 * back-and-forth to work out which to pick. Nova only suggests. Nothing here changes the budget.
 */
export function NovaBudgetPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const checks = useReviewChecks(project.projectId);
  const ask = useAskNovaBudget(project.projectId);
  const [answer, setAnswer] = useState<BudgetReviewAdvice | null>(null);
  const [question, setQuestion] = useState('');

  const send = (q: string) =>
    ask.mutate(
      { question: q, history: answer?.history ?? [] },
      {
        onSuccess: (a) => {
          setAnswer(a);
          setQuestion('');
        },
      },
    );

  if (checks.isPending || checks.error || !checks.data?.hasBudget) {
    return checks.error ? (
      <ErrorAlert error={checks.error} title="We couldn't run the budget checks" />
    ) : null;
  }
  const findings = checks.data.findings;
  const optionsFor = (id: string | null) =>
    (answer?.options ?? []).filter((o) => o.findingId === id);
  const pointsFor = (id: string | null) => (answer?.points ?? []).filter((p) => p.findingId === id);

  return (
    <Card>
      <section aria-labelledby="nova-budget-title" className="stack">
        <div className="row-actions">
          <div>
            <h2 id="nova-budget-title" className="u-m-0">
              Ask Nova about this budget
            </h2>
            <p className="u-m-0 u-caption">
              {findings.length === 0
                ? 'The checks found nothing to flag.'
                : `${findings.length} thing${findings.length === 1 ? '' : 's'} to look at. Found by the checks, not by AI.`}
            </p>
          </div>
          <Button
            variant="secondary"
            loading={ask.isPending && !question}
            onClick={() => send('')}
            disabled={ask.isPending}
          >
            {answer ? 'Start again' : 'Review with Nova'}
          </Button>
        </div>

        {findings.length > 0 ? (
          <ul className="plain-list stack">
            {findings.map((f) => (
              <li key={f.id} className="stack">
                <span className="row-actions">
                  <StatusPill tone={f.severity === 'high' ? 'danger' : 'warning'}>
                    {KIND_LABEL[f.kind]}
                  </StatusPill>
                  <span className="u-mono u-nowrap">{f.code}</span>
                  <span>{f.codeDescription}</span>
                </span>
                <p className="u-m-0">{f.summary}</p>
                {pointsFor(f.id).map((p) => (
                  <p key={p.text} className="u-m-0 u-caption">
                    {p.text}
                  </p>
                ))}
                {optionsFor(f.id).length > 0 ? (
                  <ul className="plain-list">
                    {optionsFor(f.id).map((o) => (
                      <li key={o.text}>
                        <strong>{OPTION_LABEL[o.kind]}.</strong> {o.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <ErrorAlert error={ask.error} title="Nova couldn't answer" />

        {answer ? (
          <div className="stack" aria-live="polite">
            <p className="u-m-0">{answer.reply}</p>
            {pointsFor(null).map((p) => (
              <p key={p.text} className="u-m-0 u-caption">
                {p.text}
              </p>
            ))}
            {optionsFor(null).length > 0 ? (
              <ul className="plain-list">
                {optionsFor(null).map((o) => (
                  <li key={o.text}>
                    <strong>{OPTION_LABEL[o.kind]}.</strong> {o.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {answer.draftReason ? (
              <Alert tone="info">
                Reason you could put on an adjustment
                {canManage ? '' : ' (ask someone who can adjust)'}: <em>{answer.draftReason}</em>
              </Alert>
            ) : null}
            {answer.notes.length > 0 ? (
              <Alert tone="warning">{answer.notes.join(' ')}</Alert>
            ) : null}
            <p className="u-m-0 u-caption">{answer.disclaimer}</p>

            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) send(question.trim());
              }}
            >
              <Textarea
                label="Ask a follow-up"
                value={question}
                maxLength={1000}
                rows={2}
                onChange={(e) => setQuestion(e.target.value)}
                hint="For example: which of these should I fix first, or write me a reason for the adjustment."
              />
              <div className="row-actions">
                <Button
                  type="submit"
                  loading={ask.isPending && !!question}
                  disabled={ask.isPending || !question.trim()}
                >
                  Ask Nova
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <p className="u-m-0 u-caption">
            Nova explains each check, suggests ways to deal with it and helps you pick one. She
            never changes the budget. Each answer uses half a Nova credit.
          </p>
        )}
      </section>
    </Card>
  );
}
