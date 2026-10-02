'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PREVIEW_CODE, PREVIEW_RETURNING_MOBILE, inductionSource } from '../data/source';
import { setProgress } from '../hooks/useInduction';
import { stepNumber, totalSteps } from '../lib/flow';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

const NOT_LISTED = '__not_listed';
const RESEND_AFTER_S = 30;

/** B2: name, company and mobile, then a one-time code by SMS (or email). A known mobile is welcomed back. */
export function DetailsStep({ opened, go, online }: StepProps) {
  const { site, induction, progress, sessionId, companies } = opened;
  const qc = useQueryClient();
  const [name, setName] = useState(progress.worker?.name ?? '');
  const [companyId, setCompanyId] = useState('');
  const [otherCompany, setOtherCompany] = useState('');
  const [mobile, setMobile] = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const companyName =
    companyId === NOT_LISTED
      ? otherCompany
      : (companies.find((c) => c.id === companyId)?.name ?? '');

  const send = useMutation({
    mutationFn: () =>
      inductionSource.sendCode(
        sessionId,
        {
          name,
          companyId: companyId && companyId !== NOT_LISTED ? companyId : null,
          companyName,
          mobile,
        },
        useEmail ? { kind: 'email', email } : { kind: 'sms' },
      ),
    onSuccess: (r) => {
      setSentTo(r.sentTo);
      setCode('');
      setResendIn(RESEND_AFTER_S);
    },
  });
  const verify = useMutation({
    mutationFn: () => inductionSource.verify(sessionId, code),
    onSuccess: (p) => setProgress(qc, p),
  });

  const step = {
    current: stepNumber({ kind: 'details' }, induction),
    total: totalSteps(induction),
  };

  if (progress.verified && progress.worker) {
    const firstName = progress.worker.name.split(/\s+/)[0];
    const card = progress.credentials.find((c) => c.type === 'white_card');
    return (
      <WorkerShell
        site={site}
        step={step}
        online={online}
        saveState="saved"
        footer={<StickyButton onClick={() => go({ kind: 'section', index: 0 })}>Next</StickyButton>}
      >
        <div className="stack">
          <h1 className="worker-title">
            {progress.returning ? `Welcome back, ${firstName}.` : `Thanks, ${firstName}.`}
          </h1>
          <p className="u-m-0">
            Your mobile is verified ({progress.worker.mobileMasked}).
            {progress.returning && card ? ' Your white card is already on file.' : ''}
          </p>
        </div>
      </WorkerShell>
    );
  }

  return (
    <WorkerShell
      site={site}
      step={step}
      online={online}
      footer={
        sentTo ? (
          <StickyButton
            loading={verify.isPending}
            blocked={code.trim().length !== 6}
            onClick={() => verify.mutate()}
          >
            {code.trim().length === 6 ? 'Verify' : 'Enter the 6-digit code to continue'}
          </StickyButton>
        ) : (
          <StickyButton loading={send.isPending} onClick={() => send.mutate()}>
            Send code
          </StickyButton>
        )
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (sentTo) verify.mutate();
          else send.mutate();
        }}
        noValidate
      >
        <h1 className="worker-title">Your details</h1>
        <Alert tone="info" title="Sample induction">
          No message is sent in the preview. The code is {PREVIEW_CODE}. Use{' '}
          {PREVIEW_RETURNING_MOBILE} to see a returning worker.
        </Alert>
        <TextField
          label="Full name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Company"
          placeholder="Choose your company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={[
            ...companies.map((c) => ({ value: c.id, label: c.name })),
            { value: NOT_LISTED, label: "My company isn't listed" },
          ]}
        />
        {companyId === NOT_LISTED ? (
          <TextField
            label="Company name"
            hint="The site manager will add it to the project."
            autoComplete="organization"
            value={otherCompany}
            onChange={(e) => setOtherCompany(e.target.value)}
          />
        ) : null}
        <TextField
          label="Mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
        {useEmail ? (
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            hint="We'll send the code here instead."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : null}
        <ErrorAlert error={send.error} title="We couldn't send the code" />
        {sentTo ? (
          <div className="stack">
            <TextField
              label="6-digit code"
              hint={`We sent it to ${sentTo}.`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <ErrorAlert error={verify.error} title="That didn't work" />
            <div className="row-actions">
              <Button
                variant="tertiary"
                disabled={resendIn > 0 || send.isPending}
                onClick={() => send.mutate()}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        ) : null}
        {!useEmail ? (
          <div>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setUseEmail(true);
                setSentTo(null);
              }}
            >
              Use email instead
            </button>
          </div>
        ) : null}
      </form>
    </WorkerShell>
  );
}
