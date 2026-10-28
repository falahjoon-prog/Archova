'use client';

import { formatDate } from '@archova/i18n';
import { CheckCircle2 } from '@archova/ui/icons';
import { WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

/**
 * B7: the finished induction. The signed record is fixed, so there is nothing to go back to; the worker leaves with
 * what to do at the gate and a free account for next time (X58).
 */
export function DoneStep({ opened, online }: Omit<StepProps, 'go'>) {
  const { site, induction, progress } = opened;
  const completion = progress.completion;
  return (
    <WorkerShell site={site} online={online}>
      <div className="stack worker-done">
        <CheckCircle2 className="worker-done__icon" size={64} aria-hidden="true" />
        <h1 className="worker-title">You&apos;re inducted for {site.siteName}.</h1>
        {completion ? (
          <p className="u-m-0">
            {induction.name}, version {completion.version}. Signed{' '}
            {formatDate(completion.completedAt, site.timeZone)}.
          </p>
        ) : null}
        <section className="worker-card" aria-labelledby="at-the-gate">
          <h2 id="at-the-gate" className="worker-subtitle">
            At the gate
          </h2>
          <p className="u-m-0">Scan the site QR code to sign in.</p>
        </section>
        <p className="u-m-0">We&apos;ll send you a copy of your signed induction.</p>
        <section className="worker-card" aria-labelledby="your-account">
          <h2 id="your-account" className="worker-subtitle">
            Your free Archova account is ready
          </h2>
          <p className="u-m-0">
            Next time just verify your mobile. You can add a passkey for faster sign-in when you
            next sign in to Archova.
          </p>
        </section>
      </div>
    </WorkerShell>
  );
}
