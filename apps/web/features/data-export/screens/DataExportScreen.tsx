'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { formatInstant } from '@/shared/lib/format';
import { sessionQuery } from '@/shared/providers/session';
import type { DataExport } from '../data/api';
import {
  useConfirmPassword,
  useCreateDataExport,
  useDataExports,
  useDownloadDataExport,
} from '../hooks/useDataExport';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (iso: string) => formatInstant(iso, tz());

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const TONE = {
  queued: 'neutral',
  running: 'info',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
} as const;
const LABEL = {
  queued: 'Waiting to start',
  running: 'Being built',
  ready: 'Ready',
  failed: 'Failed',
  expired: 'Expired',
} as const;

function ExportRow({ e }: { e: DataExport }) {
  const download = useDownloadDataExport();
  return (
    <li className="data-export__row">
      <div className="data-export__head">
        <strong>Started {when(e.createdAt)}</strong>
        <StatusPill tone={TONE[e.status]}>{LABEL[e.status]}</StatusPill>
      </div>
      {e.status === 'ready' && e.sizeBytes !== null ? (
        <>
          <p className="u-caption u-m-0">
            {size(e.sizeBytes)} · {e.tableCount} tables · {e.fileCount} files
            {e.skippedFileCount
              ? ` · ${e.skippedFileCount} could not be included (listed in the manifest)`
              : ''}
            {e.expiresAt ? ` · available until ${when(e.expiresAt)}` : ''}
          </p>
          {e.sha256 ? <p className="u-caption u-m-0">SHA-256 {e.sha256}</p> : null}
          <div>
            <Button onClick={() => download.mutate(e.id)} disabled={download.isPending}>
              Download zip
            </Button>
          </div>
          {download.isError ? (
            <ErrorAlert error={download.error} title="We couldn't start the download" />
          ) : null}
        </>
      ) : null}
      {e.status === 'failed' && e.error ? <p className="u-muted u-m-0">{e.error}</p> : null}
      {e.status === 'queued' || e.status === 'running' ? (
        <p className="u-caption u-m-0">
          This can take a few minutes, or longer if you have a lot of drawings. You can leave this
          page.
        </p>
      ) : null}
    </li>
  );
}

export function DataExportScreen() {
  const exports = useDataExports();
  const create = useCreateDataExport();
  const confirm = useConfirmPassword();
  const session = useQuery(sessionQuery);
  const [password, setPassword] = useState('');
  const stepUp = isApiError(create.error) && create.error.code === 'auth.step_up_required';
  const busy =
    exports.data?.data.some((e) => e.status === 'queued' || e.status === 'running') ?? false;

  function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = session.data?.user.email;
    if (!email || !password) return;
    confirm.mutate(
      { email, password },
      {
        onSuccess: () => {
          setPassword('');
          create.mutate();
        },
      },
    );
  }

  return (
    <div className="stack">
      <h1>Export your data</h1>
      <Card title="Full export">
        <div className="stack">
          <p className="u-muted">
            One zip with everything your company holds in Archova: every record as a CSV file, every
            drawing, document, photo and evidence file exactly as uploaded, and a manifest with
            checksums so you can verify it. It is yours to keep and to take elsewhere, and it works
            even if your plan has ended. Only owners and admins can export, and the file is kept for
            7 days.
          </p>
          {stepUp ? (
            <form className="stack" onSubmit={onConfirm} noValidate>
              <Alert tone="warning" title="Confirm it's you">
                Enter your password to start the export.
              </Alert>
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {confirm.isError ? (
                <ErrorAlert error={confirm.error} title="We couldn't confirm your password" />
              ) : null}
              <div>
                <Button type="submit" disabled={!password || confirm.isPending || create.isPending}>
                  Confirm and start export
                </Button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <div>
                <Button onClick={() => create.mutate()} disabled={create.isPending || busy}>
                  {busy ? 'Export in progress' : 'Export everything'}
                </Button>
              </div>
              {create.isError ? (
                <ErrorAlert error={create.error} title="We couldn't start the export" />
              ) : null}
            </div>
          )}
        </div>
      </Card>

      <Card title="Your exports">
        {exports.isPending ? <SkeletonRows rows={2} label="Loading exports…" /> : null}
        {exports.isError ? (
          <ErrorAlert error={exports.error} title="We couldn't load your exports" />
        ) : null}
        {exports.data ? (
          exports.data.data.length ? (
            <ul className="data-export__list">
              {exports.data.data.map((e) => (
                <ExportRow key={e.id} e={e} />
              ))}
            </ul>
          ) : (
            <p className="u-muted">You haven't exported yet.</p>
          )
        ) : null}
      </Card>
    </div>
  );
}
