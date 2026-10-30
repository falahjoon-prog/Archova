'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, Select, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { serverFieldErrors } from '@/shared/lib/forms';
import type { SupportSession } from '../data/api';
import {
  useGrantSupportAccess,
  useRevokeSupportAccess,
  useSupportAccess,
} from '../hooks/useSupportAccess';

const HOURS = [
  { value: '4', label: '4 hours' },
  { value: '24', label: '1 day' },
  { value: '48', label: '2 days' },
  { value: '72', label: '3 days (the most)' },
];

const SESSION_LABEL: Record<SupportSession['status'], string> = {
  open: 'Open now',
  ended: 'Ended by support',
  expired: 'Timed out',
  revoked: 'You withdrew access',
};

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso: string) => formatInstant(iso, tz());

function SessionRow({ s }: { s: SupportSession }) {
  const pages = s.pagesViewed ?? 0;
  return (
    <li className="support-access__session">
      <span>
        <strong>{s.staffName}</strong> · ticket {s.ticketRef}
      </span>
      <span className="u-caption">
        {when(s.startedAt)} · {SESSION_LABEL[s.status]} · {pages} {pages === 1 ? 'page' : 'pages'}{' '}
        viewed
      </span>
    </li>
  );
}

/**
 * Settings → Support access (Sam 12 §4a). Off by default. An owner or admin allows Archova support to view this
 * company's data, read only, for one ticket and up to 72 hours, and can withdraw it at any time.
 */
export function SupportAccessScreen() {
  const status = useSupportAccess();
  const grant = useGrantSupportAccess();
  const revoke = useRevokeSupportAccess();
  const [ticketRef, setTicketRef] = useState('');
  const [hours, setHours] = useState('24');
  const server = serverFieldErrors(grant.error);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (ticketRef.trim().length < 2) return;
    grant.mutate(
      { ticketRef: ticketRef.trim(), hours: Number(hours) },
      { onSuccess: () => setTicketRef('') },
    );
  }

  if (status.isPending) return <SkeletonRows rows={3} label="Loading support access…" />;
  if (status.isError)
    return <ErrorAlert error={status.error} title="We couldn't load support access" />;
  const active = status.data.grants.find((g) => g.status === 'active');
  const open = status.data.sessions.find((s) => s.status === 'open');

  return (
    <div className="stack">
      <h1>Support access</h1>
      <p className="u-muted">
        Archova support cannot see your data unless you allow it. Access is for one support ticket,
        read only, and ends when you withdraw it or the time runs out. Every session is listed below
        with the name of the person who opened it.
      </p>

      <Card title="Access">
        {active ? (
          <div className="stack">
            <p>
              <StatusPill tone={open ? 'warning' : 'info'}>
                {open ? 'Support is viewing now' : 'Allowed'}
              </StatusPill>
            </p>
            <dl className="details">
              <div>
                <dt>Ticket</dt>
                <dd>{active.ticketRef}</dd>
              </div>
              <div>
                <dt>Allowed by</dt>
                <dd>{active.grantedBy}</dd>
              </div>
              <div>
                <dt>Until</dt>
                <dd>{when(active.expiresAt)}</dd>
              </div>
            </dl>
            {revoke.isError ? (
              <ErrorAlert error={revoke.error} title="We couldn't withdraw access" />
            ) : null}
            <div>
              <Button
                variant="danger"
                onClick={() => revoke.mutate(active.id)}
                disabled={revoke.isPending}
              >
                Withdraw access now
              </Button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={onSubmit} noValidate>
            <p>
              <StatusPill tone="neutral">Off</StatusPill>
            </p>
            <TextField
              label="Support ticket reference"
              hint="Support can only work on this ticket."
              value={ticketRef}
              onChange={(e) => setTicketRef(e.target.value)}
              error={server.ticketRef}
              maxLength={60}
              required
            />
            <Select
              label="How long"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              options={HOURS}
            />
            {grant.isError && !Object.keys(server).length ? (
              <ErrorAlert error={grant.error} title="We couldn't allow access" />
            ) : null}
            <div>
              <Button type="submit" disabled={grant.isPending || ticketRef.trim().length < 2}>
                Allow support access
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card title="Recent sessions">
        {status.data.sessions.length ? (
          <ul className="support-access__list">
            {status.data.sessions.slice(0, 10).map((s) => (
              <SessionRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="u-muted">Support has not opened any sessions.</p>
        )}
      </Card>
    </div>
  );
}
