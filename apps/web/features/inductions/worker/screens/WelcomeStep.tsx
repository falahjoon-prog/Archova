'use client';

import { furthestStep, aboutMinutes, stepNumber, totalSteps } from '../lib/flow';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { InductionSite } from '../lib/types';
import type { StepProps } from './types';

/** B1: what this is, how long it takes, what to have ready, and the collection notice (IND-AC12). */
export function WelcomeStep({ opened, go, online }: StepProps) {
  const { site, induction, progress } = opened;
  const furthest = furthestStep(induction, progress);
  const resuming = progress.verified && furthest.kind !== 'done';
  return (
    <WorkerShell
      site={site}
      online={online}
      footer={
        <StickyButton onClick={() => go(resuming ? furthest : { kind: 'details' })}>
          {resuming
            ? `Continue where you left off (step ${stepNumber(furthest, induction)} of ${totalSteps(induction)})`
            : 'Start'}
        </StickyButton>
      }
    >
      <div className="stack">
        <p className="worker-eyebrow">{site.builderName}</p>
        <h1 className="worker-title">Site induction</h1>
        <p className="u-m-0">
          <strong>{site.siteName}</strong>
          <br />
          {site.siteAddress}
        </p>
        <p className="u-m-0">{aboutMinutes(induction.estimatedMinutes)}.</p>
        <section className="worker-card" aria-labelledby="have-ready">
          <h2 id="have-ready" className="worker-subtitle">
            Have ready
          </h2>
          <p className="u-m-0">Your white card, and any high-risk work licences.</p>
        </section>
        <CollectionNotice site={site} />
      </div>
    </WorkerShell>
  );
}

/** Sam's wording, pending lawyer review (design 08 B1). The privacy notice link joins when that page exists. */
function CollectionNotice({ site }: { site: InductionSite }) {
  return (
    <section className="worker-notice" aria-labelledby="privacy">
      <h2 id="privacy" className="worker-subtitle">
        Your information
      </h2>
      <p className="u-m-0">
        {site.builderName} uses Archova to keep site safety records. We&apos;ll store your name,
        company, mobile number, your answers, your signature, and photos and details of your
        tickets. Your site managers, safety team and your employer can see them. Ticket photos are
        deleted 12 months after the ticket expires or your work with {site.builderName} ends. Your
        induction record is kept for at least 7 years as a safety record.
      </p>
    </section>
  );
}

/** B1 when the link has expired or been revoked. */
export function LinkNotWorking({ site, online }: { site: InductionSite; online: boolean }) {
  return (
    <WorkerShell site={site} online={online}>
      <div className="stack">
        <h1 className="worker-title">This link no longer works</h1>
        <p className="u-m-0">Ask your employer or the site office for a new one.</p>
        <p className="u-m-0">
          Site office:{' '}
          <a className="link" href={`tel:${site.officePhone.replace(/\s/g, '')}`}>
            {site.officePhone}
          </a>
        </p>
      </div>
    </WorkerShell>
  );
}
