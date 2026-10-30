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

const END_LABEL = {
  staff: 'Ended by support',
  customer_revoked: 'You withdrew access',
  expired: 'Timed out',
} as const;

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso: string) => formatInstant(iso, tz());

function SessionRow({ s }: { s: SupportSession }) {
  return (
    <li className="support-access__session">
      <span>
        <strong>{s.staffName}</strong> · ticket {s.ticketRef}
      </span>
      <span className="u-caption">
        {when(s.startedAt)} · {s.endedAt && s.endedReason ? END_LABEL[s.endedReason] : 'Open now'} ·{' '}
        {s.pagesViewed} {s.pagesViewed === 1 ? 'page' : 'pages'} viewed
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
  const [note, setNote] = useState('');
  const server = serverFieldErrors(grant.error);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ticketRef.trim()) return;
    grant.mutate(
      {
        ticketRef: ticketRef.trim(),
        hours: Number(hours),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          setTicketRef('');
          setNote('');
        },
      },
    );
  }

  if (status.isPending) return <SkeletonRows rows={3} label="Loading support access…" />;
  if (status.isError)
    return <ErrorAlert error={status.error} title="We couldn't load support access" />;
  const { grant: g, session, history } = status.data;

  return (
    <div className="stack">
      <h1>Support access</h1>
      <p className="u-muted">
        Archova support cannot see your data unless you allow it. Access is for one support ticket,
        read only, and ends when you withdraw it or the time runs out. Every session is listed below
        with the name of the person who opened it.
      </p>

      <Card title="Access">
        {g ? (
          <div className="stack">
            <p>
              <StatusPill tone={session ? 'warning' : 'info'}>
                {session ? 'Support is viewing now' : 'Allowed'}
              </StatusPill>
            </p>
            <dl className="details">
              <div>
                <dt>Ticket</dt>
                <dd>{g.ticketRef}</dd>
              </div>
              <div>
                <dt>Allowed by</dt>
                <dd>{g.grantedBy}</dd>
              </div>
              <div>
                <dt>Until</dt>
                <dd>{when(g.expiresAt)}</dd>
              </div>
              {g.note ? (
                <div>
                  <dt>Note</dt>
                  <dd>{g.note}</dd>
                </div>
              ) : null}
            </dl>
            {revoke.isError ? (
              <ErrorAlert error={revoke.error} title="We couldn't withdraw access" />
            ) : null}
            <div>
              <Button variant="danger" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
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
            <TextField
              label="Note for support (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={server.note}
              maxLength={500}
            />
            {grant.isError && !Object.keys(server).length ? (
              <ErrorAlert error={grant.error} title="We couldn't allow access" />
            ) : null}
            <div>
              <Button type="submit" disabled={grant.isPending || !ticketRef.trim()}>
                Allow support access
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card title="Recent sessions">
        {history.length ? (
          <ul className="support-access__list">
            {history.map((s) => (
              <SessionRow key={`${s.startedAt}-${s.staffName}`} s={s} />
            ))}
          </ul>
        ) : (
          <p className="u-muted">Support has not opened any sessions.</p>
        )}
      </Card>
    </div>
  );
}
