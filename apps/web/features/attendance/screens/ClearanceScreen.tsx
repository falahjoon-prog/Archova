'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  StatusPill,
  TextField,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useClearanceCheck } from '../hooks/useAttendance';
import type { WorkerClearance } from '../data/clearance';

const RESULT: Record<WorkerClearance['result'], { tone: StatusTone; label: string }> = {
  cleared: { tone: 'success', label: 'Cleared for site' },
  warning: { tone: 'warning', label: 'Cleared, with warnings' },
  blocked: { tone: 'danger', label: 'Not cleared' },
};
const CHECK: Record<
  WorkerClearance['checks'][number]['status'],
  { tone: StatusTone; label: string }
> = {
  pass: { tone: 'success', label: 'OK' },
  warn: { tone: 'warning', label: 'Check' },
  fail: { tone: 'danger', label: 'Missing' },
  na: { tone: 'neutral', label: 'N/A' },
};

/**
 * Site clearance: scan a worker's Safety ID (a hardware scanner types the code and presses Enter) or paste
 * the worker id, and see in one glance whether they may be on site today. Read only; it signs no one in.
 */
export function ClearanceScreen() {
  const check = useClearanceCheck();
  const [typed, setTyped] = useState('');

  const run = (code: string) => {
    const value = code.trim();
    if (value) check.mutate(value);
  };
  // A link with `#code=` runs straight away (the badge code never goes to the server except in the API call).
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash);
    const m = /code=(.+)$/.exec(hash);
    if (m?.[1]) {
      setTyped(m[1]);
      check.mutate(m[1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(typed);
  };
  const r = check.data;

  return (
    <>
      <PageHeader
        eyebrow="Workforce"
        title="Site clearance"
        description="Scan a Safety ID to see whether this person is cleared to be on site today: white card, licences, site induction and SWMS in one check."
      />
      <div className="stack">
        <Card title="Scan or enter a Safety ID">
          <form className="stack" onSubmit={onSubmit}>
            <TextField
              label="Safety ID code"
              hint="Point a scanner at the badge QR, or paste the code (archova:badge:wkr_…)."
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              inputMode="text"
            />
            <div>
              <Button type="submit" disabled={!typed.trim() || check.isPending}>
                {check.isPending ? 'Checking…' : 'Check clearance'}
              </Button>
            </div>
          </form>
        </Card>
        <ErrorAlert error={check.error} title="We couldn’t check that code" />
        {r ? (
          <>
            {r.flag ? (
              <Alert
                tone={r.flag.severity === 'blocking' ? 'danger' : 'warning'}
                title={r.flag.title}
              >
                <p className="u-m-0">{r.flag.suggestedAction}</p>
              </Alert>
            ) : null}
            <Card title={r.fullName}>
              <div className="stack">
                <div className="row">
                  {r.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.photoUrl} alt={`Photo of ${r.fullName}`} width={72} height={72} />
                  ) : null}
                  <div>
                    <p className="u-m-0">{r.companyName ?? 'No company recorded'}</p>
                    <StatusPill tone={RESULT[r.result].tone}>{RESULT[r.result].label}</StatusPill>
                  </div>
                </div>
                <ul className="stack" aria-label="Clearance checks">
                  {r.checks.map((c) => (
                    <li key={c.key} className="row">
                      <StatusPill tone={CHECK[c.status].tone}>{CHECK[c.status].label}</StatusPill>
                      <span>
                        <strong>{c.label}</strong>: {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="u-m-0">
                  Checked for {r.localDate}. This does not sign the person in.
                </p>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
