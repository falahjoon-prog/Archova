'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Button } from '@archova/ui';
import { fileDownloadUrl } from '@/shared/lib/uploads';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { Check } from '../data/api';
import type { usePrefabMutations } from '../hooks/usePrefab';

function Thumb({ fileId, label }: { fileId: string; label: string }) {
  const { orgId } = useCurrentOrg();
  const url = useQuery({
    queryKey: ['prefab-photo', orgId, fileId],
    queryFn: () => fileDownloadUrl(orgId, fileId),
    staleTime: 4 * 60_000,
  });
  if (!url.data) return <span className="pfb-photo pfb-photo--empty">…</span>;
  return (
    <a href={url.data} target="_blank" rel="noreferrer" className="pfb-photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset */}
      <img src={url.data} alt={label} loading="lazy" />
    </a>
  );
}

/** Photos on one QA check: thumbnails that open full size, and an add button (the camera on a phone). */
export function CheckPhotos({
  unitId,
  check,
  canWrite,
  m,
}: {
  unitId: string;
  check: Check;
  canWrite: boolean;
  m: ReturnType<typeof usePrefabMutations>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = m.checkPhotos.isPending;
  const base = { id: check.id, result: check.result, note: check.note };
  if (!check.fileIds.length && !canWrite) return null;
  return (
    <div className="pfb-photos">
      {check.fileIds.map((f, i) => (
        <span key={f} className="pfb-photo-wrap">
          <Thumb fileId={f} label={`${check.label}, photo ${i + 1}`} />
          {canWrite ? (
            <Button
              size="sm"
              variant="tertiary"
              disabled={busy}
              aria-label={`Remove photo ${i + 1} from ${check.label}`}
              onClick={() =>
                m.checkPhotos.mutate({
                  unitId,
                  check: base,
                  fileIds: check.fileIds.filter((x) => x !== f),
                })
              }
            >
              Remove
            </Button>
          ) : null}
        </span>
      ))}
      {canWrite ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label={`Add a photo to ${check.label}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                m.checkPhotos.mutate({ unitId, check: base, fileIds: check.fileIds, add: file });
            }}
          />
          <Button
            size="sm"
            variant="tertiary"
            loading={busy}
            disabled={check.fileIds.length >= 10}
            onClick={() => input.current?.click()}
          >
            Add photo
          </Button>
        </>
      ) : null}
    </div>
  );
}
