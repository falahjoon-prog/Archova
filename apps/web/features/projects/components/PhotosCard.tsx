'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { Card, Dialog, SkeletonRows } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { fetchProjectPhotos, type ProjectPhoto } from '../data/photos';

const SHOWN = 6;
const FETCHED = 12;

const SOURCE_LABELS: Record<string, string> = {
  diary: 'Site diary',
  defects: 'Defect',
  quality: 'Inspection',
  rfis: 'RFI',
  photos: 'Photo',
};

export const photoSource = (module: string) => SOURCE_LABELS[module] ?? 'Photo';

/** Project home: the latest site photos from the diary, defects, inspections and RFIs. Tap one to see it larger. */
export function PhotosCard({ projectId, timeZone }: { projectId: string; timeZone: string }) {
  const { orgId } = useCurrentOrg();
  const [open, setOpen] = useState<ProjectPhoto | null>(null);
  const photos = useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'photos', { limit: FETCHED }),
    queryFn: () => fetchProjectPhotos(orgId, projectId, FETCHED),
    // The signed links last 5 minutes; refetch before they lapse.
    staleTime: 3 * 60_000,
  });
  const shown = (photos.data ?? []).slice(0, SHOWN);

  return (
    <Card title="Photos">
      <ErrorAlert error={photos.error} title="We couldn't load the photos" />
      {photos.isPending ? <SkeletonRows rows={2} label="Loading photos…" /> : null}
      {photos.data && shown.length === 0 ? (
        <p className="u-muted">
          No photos yet. Photos added to site diaries, defects, inspections and RFIs show up here.
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul className="photo-grid">
          {shown.map((p) => (
            <li key={p.file.id}>
              <button
                type="button"
                className="photo-grid__tile"
                onClick={() => setOpen(p)}
                aria-label={`Open ${p.file.filename}, ${photoSource(p.file.module)}`}
              >
                {/* Signed storage links, not static assets, so next/image can't optimise them. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.file.filename ?? 'Photo'}
      >
        {open ? (
          <div className="stack">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="photo-grid__full" src={open.url} alt={open.file.filename} />
            <p className="u-caption">
              {photoSource(open.file.module)} ·{' '}
              {formatInstant(open.file.capture?.takenAt ?? open.file.createdAt, timeZone)}
            </p>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}
