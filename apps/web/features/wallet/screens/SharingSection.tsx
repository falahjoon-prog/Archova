'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  SkeletonRows,
  StatusPill,
  TextField,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { formatLocalDate } from '@/shared/lib/format';
import { useAccessLog, useGrants, useSharingMutations } from '../hooks/useSharing';
import type { AccessLogEntry, Grant, ShareCodePreview } from '../data/sharing-api';
import { ITEM_TYPE_LABELS } from '../lib/types';

const STATUS_TONE: Record<Grant['status'], StatusTone> = {
  live: 'success',
  expired: 'neutral',
  revoked: 'neutral',
};
const STATUS_LABEL: Record<Grant['status'], string> = {
  live: 'Live',
  expired: 'Ended',
  revoked: 'Revoked',
};
const KIND_LABEL: Record<AccessLogEntry['kind'], string> = {
  list: 'Looked at the wallet',
  document: 'Looked at a document',
  file: 'Opened a file',
};

const scopeOf = (r: { allProjects: boolean; projectName: string | null }) =>
  r.allProjects ? 'All of their projects' : (r.projectName ?? 'One project');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function AcceptCard() {
  const m = useSharingMutations();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ code: string; data: ShareCodePreview } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function onPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDone(null);
    const c = code.trim();
    if (!c) return;
    m.preview.mutate(c, { onSuccess: (data) => setPreview({ code: c, data }) });
  }

  return (
    <Card title="A builder asked for your documents">
      <div className="stack">
        <p className="u-caption">
          Enter the code the builder gave you. You see exactly what they are asking for before
          anything is shared, and you can end the access at any time.
        </p>
        <form className="stack" onSubmit={onPreview} noValidate>
          <TextField
            label="Code from the builder"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setPreview(null);
            }}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={m.preview.isPending || !code.trim()}
            >
              {m.preview.isPending ? 'Checking…' : 'See the request'}
            </Button>
          </div>
        </form>
        {m.preview.isError ? (
          isApiError(m.preview.error, 404) ? (
            <Alert tone="danger">
              That code isn’t valid. It may be wrong, used, cancelled or out of date. Ask the
              builder for a new one.
            </Alert>
          ) : (
            <ErrorAlert error={m.preview.error} title="We couldn’t check that code" />
          )
        ) : null}
        {preview ? (
          <Alert tone="info" title={`${preview.data.requesterName} is asking to read`}>
            <p>{preview.data.itemTypes.map((t) => ITEM_TYPE_LABELS[t]).join(', ')}</p>
            <p>
              For {preview.data.allProjects ? 'all of their projects' : preview.data.projectName},
              until {formatLocalDate(preview.data.grantExpiresOn)}.
            </p>
            <p className="u-caption">
              They see the details and the last four characters of a number, and can open the files
              you attach. A working-with-children check is never shared. Every time they look is
              recorded below.
            </p>
            <div className="wallet__actions">
              <Button
                disabled={m.accept.isPending}
                onClick={() =>
                  m.accept.mutate(preview.code, {
                    onSuccess: (g) => {
                      setDone(`Shared with ${g.granteeName}.`);
                      setPreview(null);
                      setCode('');
                    },
                  })
                }
              >
                {m.accept.isPending ? 'Sharing…' : 'Share these documents'}
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Not now
              </Button>
            </div>
          </Alert>
        ) : null}
        {m.accept.isError ? (
          <ErrorAlert error={m.accept.error} title="We couldn’t share your documents" />
        ) : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
      </div>
    </Card>
  );
}

function GrantsCard() {
  const grants = useGrants();
  const m = useSharingMutations();
  return (
    <Card title="Who can read your wallet">
      <div className="stack">
        {grants.isPending ? <SkeletonRows rows={2} label="Loading…" /> : null}
        {grants.isError ? (
          isApiError(grants.error, 403) ? (
            <p className="u-muted">You don’t have access to sharing settings.</p>
          ) : (
            <ErrorAlert error={grants.error} title="We couldn’t load who can read your wallet" />
          )
        ) : null}
        {grants.data && grants.data.length === 0 ? (
          <p className="u-muted">Nobody can read your wallet.</p>
        ) : null}
        {grants.data?.length ? (
          <ul className="wallet__list">
            {grants.data.map((g) => (
              <li key={g.id} className="wallet__row">
                <div className="wallet__head">
                  <strong>{g.granteeName}</strong>
                  <StatusPill tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</StatusPill>
                </div>
                <span className="u-caption">
                  {g.itemTypes.map((t) => ITEM_TYPE_LABELS[t]).join(', ')} · {scopeOf(g)} · Access
                  to {formatLocalDate(g.expiresOn)}
                </span>
                {g.status === 'live' ? (
                  <div className="wallet__actions">
                    <Button
                      variant="secondary"
                      disabled={m.revoke.isPending}
                      onClick={() => m.revoke.mutate(g)}
                    >
                      End access<span className="u-visually-hidden"> for {g.granteeName}</span>
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {m.revoke.isError ? (
          <ErrorAlert error={m.revoke.error} title="We couldn’t end the access" />
        ) : null}
      </div>
    </Card>
  );
}

function LogCard() {
  const log = useAccessLog();
  return (
    <Card title="Who has looked">
      <div className="stack">
        <p className="u-caption">
          Every time a builder looks at your wallet or opens a file, newest first. This is always
          on.
        </p>
        {log.isPending ? <SkeletonRows rows={2} label="Loading…" /> : null}
        {log.isError ? (
          isApiError(log.error, 403) ? null : (
            <ErrorAlert error={log.error} title="We couldn’t load the access log" />
          )
        ) : null}
        {log.data && log.data.length === 0 ? (
          <p className="u-muted">Nobody has looked yet.</p>
        ) : null}
        {log.data?.length ? (
          <ul className="wallet__list">
            {log.data.map((l) => (
              <li key={l.id} className="wallet__row">
                <strong>{l.granteeName}</strong>
                <span className="u-caption">
                  {KIND_LABEL[l.kind]}
                  {l.itemType ? ` · ${ITEM_TYPE_LABELS[l.itemType]}` : ''} · {when(l.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

/** The company's side of sharing (compliance/05 §7): accept a builder's code, see and end access, read the log. */
export function SharingSection() {
  return (
    <>
      <AcceptCard />
      <GrantsCard />
      <LogCard />
    </>
  );
}
