'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SkeletonRows } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { setProgress, useInductionSource } from '../hooks/useInduction';
import { stepNumber, totalSteps } from '../lib/flow';
import type { QuizResult } from '../lib/types';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

/**
 * B4: one question per screen with large options. Answers go to the server, which scores them (IND-AC5); a fail
 * lists the sections to look at again, and retries are unlimited.
 */
export function QuizStep({ opened, go, online }: StepProps) {
  const { site, induction, progress, sessionId } = opened;
  const qc = useQueryClient();
  const source = useInductionSource();
  const questions = useQuery({
    queryKey: ['induction', 'quiz', sessionId],
    queryFn: () => source.quizQuestions(sessionId),
    staleTime: Infinity,
  });
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const submit = useMutation({
    mutationFn: () => source.submitQuiz(sessionId, answers),
    onSuccess: ({ result: r, progress: p }) => {
      setResult(r);
      setProgress(qc, p);
    },
  });

  const step = { current: stepNumber({ kind: 'quiz' }, induction), total: totalSteps(induction) };
  const shell = (children: ReactNode, footer: ReactNode) => (
    <WorkerShell site={site} step={step} online={online} saveState="saved" footer={footer}>
      <div className="stack">{children}</div>
    </WorkerShell>
  );

  if (progress.quiz.passed && !result) {
    return shell(
      <>
        <h1 className="worker-title">Quiz</h1>
        <p className="u-m-0">You&apos;ve passed the quiz.</p>
      </>,
      <StickyButton onClick={() => go({ kind: 'credentials' })}>Continue</StickyButton>,
    );
  }

  if (result) {
    if (result.passed) {
      return shell(
        <>
          <h1 className="worker-title">
            You passed ({result.correct} of {result.total}).
          </h1>
        </>,
        <StickyButton onClick={() => go({ kind: 'credentials' })}>Continue</StickyButton>,
      );
    }
    const review = induction.sections
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => result.reviewSectionIds.includes(s.id));
    return shell(
      <>
        <h1 className="worker-title">
          You got {result.correct} of {result.total}.
        </h1>
        <p className="u-m-0">
          {result.missedCritical
            ? 'You need every safety-critical question right to pass.'
            : `You need ${result.needed} to pass.`}
        </p>
        {result.seeSiteOffice ? (
          <p className="u-m-0">
            You&apos;ve tried a few times. Please see the site office, and we&apos;ve let the site
            manager know.
          </p>
        ) : null}
        <section aria-labelledby="review">
          <h2 id="review" className="worker-subtitle">
            Look at these again
          </h2>
          <ul className="plain-list stack">
            {review.map(({ s, index }) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => go({ kind: 'section', index })}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </>,
      <StickyButton
        onClick={() => {
          setResult(null);
          setAnswers({});
          setI(0);
        }}
      >
        Try again
      </StickyButton>,
    );
  }

  if (questions.isPending) return shell(<SkeletonRows label="Loading the quiz…" />, null);
  if (questions.isError)
    return shell(<ErrorAlert error={questions.error} title="We couldn't load the quiz" />, null);

  const qs = questions.data;
  const q = qs[i]!;
  const last = i === qs.length - 1;
  const chosen = answers[q.id];
  return shell(
    <>
      <p className="worker-eyebrow">
        Question {i + 1} of {qs.length}
      </p>
      <fieldset className="worker-quiz">
        <legend className="worker-title">{q.text}</legend>
        {q.options.map((o) => (
          <label key={o.id} className="worker-option">
            <input
              type="radio"
              name={q.id}
              value={o.id}
              checked={chosen === o.id}
              onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
            />
            <span>{o.text}</span>
          </label>
        ))}
      </fieldset>
      <ErrorAlert error={submit.error} title="We couldn't check your answers" />
    </>,
    <StickyButton
      blocked={!chosen}
      loading={submit.isPending}
      back={i > 0 ? () => setI(i - 1) : undefined}
      onClick={() => (last ? submit.mutate() : setI(i + 1))}
    >
      {!chosen ? 'Choose an answer to continue' : last ? 'Check my answers' : 'Next'}
    </StickyButton>,
  );
}
