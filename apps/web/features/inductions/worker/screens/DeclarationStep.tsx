'use client';

import { useState } from 'react';
import { Checkbox, SignaturePad, TextField, type SignatureValue } from '@archova/ui';
import { formatDate } from '@archova/i18n';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { inductionSource } from '../data/source';
import { useProgressMutation } from '../hooks/useInduction';
import { stepNumber, totalSteps } from '../lib/flow';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

/**
 * B6: the version being signed, each statement ticked, the full name, and a drawn or typed signature. The server
 * ties the record to a hash of exactly this version (X58, IND-AC6); the device time goes with it.
 */
export function DeclarationStep({ opened, go, online }: StepProps) {
  const { site, induction, progress } = opened;
  const [ticked, setTicked] = useState<boolean[]>(() => induction.declaration.map(() => false));
  const [name, setName] = useState(progress.worker?.name ?? '');
  const [signature, setSignature] = useState<SignatureValue>(null);
  const sign = useProgressMutation((sid, _: null) =>
    inductionSource.sign(sid, {
      statementsAccepted: ticked.filter(Boolean).length,
      name,
      signature: signature!,
      deviceTime: new Date().toISOString(),
    }),
  );

  const missing = !ticked.every(Boolean)
    ? 'Tick each statement to sign'
    : !name.trim()
      ? 'Type your full name to sign'
      : !signature
        ? 'Sign in the box to finish'
        : null;

  return (
    <WorkerShell
      site={site}
      step={{
        current: stepNumber({ kind: 'declaration' }, induction),
        total: totalSteps(induction),
      }}
      saveState={sign.isPending ? 'saving' : 'saved'}
      online={online}
      footer={
        <StickyButton
          back={() => go({ kind: 'credentials' })}
          blocked={missing !== null}
          loading={sign.isPending}
          onClick={() =>
            sign.mutate(
              { sessionId: opened.sessionId, args: null },
              { onSuccess: () => go({ kind: 'done' }) },
            )
          }
        >
          {missing ?? 'Sign and finish'}
        </StickyButton>
      }
    >
      <div className="stack">
        <h1 className="worker-title">Sign your induction</h1>
        <p className="u-m-0">
          {induction.name}, version {induction.version}, published{' '}
          {formatDate(induction.publishedAt, site.timeZone)}.
        </p>
        <fieldset className="worker-card stack">
          <legend className="worker-subtitle">Tick each statement</legend>
          {induction.declaration.map((statement, i) => (
            <Checkbox
              key={statement}
              label={statement}
              checked={ticked[i] ?? false}
              onChange={(e) => setTicked((t) => t.map((v, j) => (j === i ? e.target.checked : v)))}
            />
          ))}
        </fieldset>
        <TextField
          label="Full name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SignaturePad name={name} onChange={setSignature} />
        <ErrorAlert error={sign.error} title="Your induction wasn't signed" />
      </div>
    </WorkerShell>
  );
}
