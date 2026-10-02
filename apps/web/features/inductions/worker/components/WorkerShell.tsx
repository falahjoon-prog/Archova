'use client';

import type { ReactNode } from 'react';
import { Alert, Button, ProgressStepper, type SaveState } from '@archova/ui';
import { Phone } from '@archova/ui/icons';
import type { InductionSite } from '../lib/types';

/**
 * The phone layout every worker screen shares (design 08 Part B): site name, Help to the site office, "Step x of y",
 * the screen, and one big sticky button at the bottom. No app shell or Nova panel, to keep the page small on 4G.
 */
export function WorkerShell({
  site,
  step,
  saveState,
  online,
  children,
  footer,
}: {
  site: InductionSite;
  step?: { current: number; total: number };
  saveState?: SaveState;
  online: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="worker-shell">
      <header className="worker-shell__header">
        <p className="worker-shell__site">{site.siteName}</p>
        <a className="worker-shell__help" href={`tel:${site.officePhone.replace(/\s/g, '')}`}>
          <Phone size={16} aria-hidden="true" /> Help
          <span className="u-visually-hidden">: call the site office on {site.officePhone}</span>
        </a>
      </header>
      {step ? (
        <ProgressStepper
          current={step.current}
          total={step.total}
          label="Induction progress"
          saveState={online ? (saveState ?? null) : 'offline'}
        />
      ) : null}
      {!online ? (
        <Alert tone="warning" title="No connection">
          Your progress is saved. We&apos;ll continue when you&apos;re back online.
        </Alert>
      ) : null}
      <main className="worker-shell__main" id="main">
        {children}
      </main>
      {footer ? <div className="worker-shell__footer">{footer}</div> : null}
    </div>
  );
}

/**
 * The sticky primary action. When it can't be used yet it stays focusable and its label says why ("Watch to the
 * end to continue, 2:14 left"), so screen reader users hear the reason (design 08 accessibility notes).
 */
export function StickyButton({
  children,
  onClick,
  blocked = false,
  loading = false,
  back,
}: {
  children: ReactNode;
  onClick: () => void;
  blocked?: boolean;
  loading?: boolean;
  back?: () => void;
}) {
  return (
    <div className="worker-actions">
      {back ? (
        <Button variant="secondary" onClick={back}>
          Back
        </Button>
      ) : null}
      <Button
        className="worker-actions__primary"
        aria-disabled={blocked || undefined}
        loading={loading}
        onClick={() => {
          if (!blocked) onClick();
        }}
      >
        {children}
      </Button>
    </div>
  );
}
