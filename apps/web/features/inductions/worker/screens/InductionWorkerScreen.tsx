'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, SkeletonRows } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useOnline, useOpenInduction } from '../hooks/useInduction';
import { furthestStep, isReachable, paramsToStep, stepToParams } from '../lib/flow';
import type { FlowStep, WorkerInduction } from '../lib/types';
import { CredentialsStep } from './CredentialsStep';
import { DeclarationStep } from './DeclarationStep';
import { DetailsStep } from './DetailsStep';
import { DoneStep } from './DoneStep';
import { QuizStep } from './QuizStep';
import { SectionStep } from './SectionStep';
import { LinkNotWorking, WelcomeStep } from './WelcomeStep';

function readStep(induction: WorkerInduction): FlowStep {
  const q = new URLSearchParams(window.location.search);
  return (
    paramsToStep({ step: q.get('step') ?? '', n: q.get('n') ?? '' }, induction) ?? {
      kind: 'welcome',
    }
  );
}

function stepUrl(step: FlowStep): string {
  const { step: s, n } = stepToParams(step);
  const q = new URLSearchParams();
  if (s) q.set('step', s);
  if (n) q.set('n', n);
  const qs = q.toString();
  return `${window.location.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * The worker's induction on their phone (design 08 Part B, frontend 11): opens the access link, then one step per
 * screen. The step is in the URL so the phone's Back button works; a step past the saved progress can't be opened,
 * and goes to the furthest one instead (IND-AC4).
 */
export function InductionWorkerScreen({ token }: { token: string }) {
  const query = useOpenInduction(token);
  const online = useOnline();
  const opened = query.data;
  const induction = opened?.state === 'open' ? opened.induction : null;
  const [requested, setRequested] = useState<FlowStep | null>(null);

  useEffect(() => {
    if (!induction) return;
    setRequested(readStep(induction));
    const onPop = () => setRequested(readStep(induction));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [induction]);

  const go = useCallback((step: FlowStep) => {
    window.history.pushState(window.history.state, '', stepUrl(step));
    setRequested(step);
    window.scrollTo?.(0, 0);
  }, []);

  if (query.isPending || (opened?.state === 'open' && !requested)) {
    return (
      <div className="worker-shell">
        <main className="worker-shell__main" id="main" aria-busy="true">
          <SkeletonRows rows={4} />
        </main>
      </div>
    );
  }
  if (query.isError || !opened) {
    return (
      <div className="worker-shell">
        <main className="worker-shell__main stack" id="main">
          <ErrorAlert error={query.error} title="Your induction didn't open" />
          <div>
            <Button onClick={() => void query.refetch()}>Try again</Button>
          </div>
        </main>
      </div>
    );
  }
  if (opened.state !== 'open') return <LinkNotWorking site={opened.site} online={online} />;

  const { induction: ind, progress } = opened;
  const step =
    requested && isReachable(requested, ind, progress) ? requested : furthestStep(ind, progress);
  const props = { opened, go, online };

  switch (step.kind) {
    case 'welcome':
      return <WelcomeStep {...props} />;
    case 'details':
      return <DetailsStep {...props} />;
    case 'section':
      return <SectionStep key={step.index} {...props} index={step.index} />;
    case 'quiz':
      return <QuizStep {...props} />;
    case 'credentials':
      return <CredentialsStep {...props} />;
    case 'declaration':
      return <DeclarationStep {...props} />;
    case 'done':
      return <DoneStep opened={opened} online={online} />;
  }
}
