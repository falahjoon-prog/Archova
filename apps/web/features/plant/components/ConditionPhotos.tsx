'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { fileDownloadUrl } from '@/shared/lib/uploads';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { PlantAsset, PlantConditionKind } from '../data/api';
import { useConditionChecks, usePlantMutations } from '../hooks/usePlant';

const MAX_PHOTOS = 10;
const KINDS: Record<PlantConditionKind, string> = {
  hire_in: 'Hire in',
  hire_out: 'Hire out',
  service: 'After a service',
};

function Thumb({ fileId, label }: { fileId: string; label: string }) {
  const { orgId } = useCurrentOrg();
  const url = useQuery({
    queryKey: ['plant-photo', orgId, fileId],
    queryFn: () => fileDownloadUrl(orgId, fileId),
    staleTime: 4 * 60_000,
  });
  if (!url.data) return <span className="plant-photo plant-photo--empty">…</span>;
  return (
    <a href={url.data} target="_blank" rel="noreferrer" className="plant-photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset */}
      <img src={url.data} alt={label} loading="lazy" />
    </a>
  );
}

/**
 * Photos of a machine's condition when it arrives on hire, goes back, or comes out of a service: evidence for damage
 * disputes and insurance claims, and a check the right unit is on site. Photos are kept as plant files by id.
 */
export function ConditionPhotos({
  machines,
  canManage,
}: {
  machines: PlantAsset[];
  canManage: boolean;
}) {
  const m = usePlantMutations();
  const [assetId, setAssetId] = useState('');
  const [kind, setKind] = useState<PlantConditionKind>('hire_in');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const checks = useConditionChecks(assetId);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assetId) return setError('Choose the machine.');
    if (files.length === 0) return setError('Add at least one photo.');
    m.recordCondition.mutate(
      { assetId, kind, files, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setFiles([]);
          setNote('');
        },
      },
    );
  }

  return (
    <div className="stack-lg">
      <Card title="Condition photos">
        <div className="stack-lg">
          <Select
            label="Machine"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            options={[
              { value: '', label: 'Choose a machine' },
              ...machines.map((a) => ({ value: a.id, label: `${a.name} (${a.assetNumber})` })),
            ]}
          />
          <ErrorAlert error={checks.error} title="We couldn't load the photos" />
          {assetId === '' ? (
            <EmptyState
              title="Choose a machine"
              description="See how it looked when it came on site, went back and after each service."
            />
          ) : checks.isPending ? (
            <SkeletonRows label="Loading photos…" />
          ) : (checks.data ?? []).length === 0 ? (
            <EmptyState
              title="No photos yet"
              description={
                canManage
                  ? 'Record its condition below when it arrives, goes back or is serviced.'
                  : 'Nobody has recorded this machine’s condition.'
              }
            />
          ) : (
            <ul className="stack-lg" aria-label="Condition records">
              {checks.data!.map((c) => (
                <li key={c.id} className="stack-sm">
                  <div className="row-actions">
                    <StatusPill tone={c.kind === 'service' ? 'info' : 'neutral'}>
                      {KINDS[c.kind]}
                    </StatusPill>
                    <span>{formatLocalDate(c.takenOn)}</span>
                  </div>
                  {c.note ? <p>{c.note}</p> : null}
                  <div className="plant-photos">
                    {c.fileIds.map((f, i) => (
                      <Thumb
                        key={f}
                        fileId={f}
                        label={`${KINDS[c.kind]}, ${formatLocalDate(c.takenOn)}, photo ${i + 1}`}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      {canManage ? (
        <Card title="Record a machine's condition">
          <form className="stack-lg" onSubmit={save} noValidate>
            <div className="form-row">
              <Select
                label="When"
                value={kind}
                onChange={(e) => setKind(e.target.value as PlantConditionKind)}
                options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))}
              />
              <TextField
                label="Note (damage, meter reading…)"
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="plant-photos">
              <input
                ref={input}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                aria-label="Add condition photos"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  setFiles((cur) => [...cur, ...picked].slice(0, MAX_PHOTOS));
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={files.length >= MAX_PHOTOS}
                onClick={() => input.current?.click()}
              >
                Add photos
              </Button>
              <span>
                {files.length === 0
                  ? `Up to ${MAX_PHOTOS} photos`
                  : `${files.length} photo${files.length === 1 ? '' : 's'} ready`}
              </span>
              {files.length > 0 ? (
                <Button type="button" variant="tertiary" onClick={() => setFiles([])}>
                  Clear
                </Button>
              ) : null}
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <ErrorAlert error={m.recordCondition.error} title="We couldn't save the photos" />
            <div className="row-actions">
              <Button type="submit" disabled={m.recordCondition.isPending}>
                {m.recordCondition.isPending ? 'Uploading…' : 'Save condition'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
