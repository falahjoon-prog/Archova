'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { Button, Card, Dialog, Select, SkeletonRows, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { fetchProjectPhotos, type PhotoFilters, type ProjectPhoto } from '../data/photos';
import { PHOTO_AGE_OPTIONS, tradeLabel } from '../lib/photo-labels';
import { PhotoTagEditor } from './PhotoTagEditor';

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

/**
 * Project home: the latest site photos from the diary, defects, inspections and RFIs, filed by area, trade and tags.
 * Filter by area, trade, tag or how recent; open one to see it larger and to tag it (Nova can suggest the tags).
 */
export function PhotosCard({ projectId, timeZone }: { projectId: string; timeZone: string }) {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState<ProjectPhoto | null>(null);
  const [filters, setFilters] = useState<PhotoFilters>({});
  const [showAll, setShowAll] = useState(false);
  const photos = useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'photos', { limit: FETCHED, ...filters }),
    queryFn: () => fetchProjectPhotos(orgId, projectId, FETCHED, filters),
    // The signed links last 5 minutes; refetch before they lapse. A narrower view keeps the last one meanwhile.
    staleTime: 3 * 60_000,
    placeholderData: (previous) => previous,
  });

  const list = photos.data?.data ?? [];
  const shown = showAll ? list : list.slice(0, SHOWN);
  const areas = photos.data?.facets.areas ?? [];
  const trades = photos.data?.facets.trades ?? [];
  const filtering = Boolean(filters.area || filters.trade || filters.tag || filters.sinceDays);
  const hasFacets = areas.length > 0 || trades.length > 0;
  const set = (patch: PhotoFilters) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShowAll(false);
  };
  const closeAndRefresh = () => {
    setOpen(null);
    void qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'photos') });
  };

  return (
    <Card title="Photos">
      <ErrorAlert error={photos.error} title="We couldn't load the photos" />
      {photos.isPending ? <SkeletonRows rows={2} label="Loading photos…" /> : null}
      {photos.data && (hasFacets || filtering || list.length > 0) ? (
        <div className="photo-filters">
          {areas.length > 0 || filters.area ? (
            <Select
              label="Area"
              placeholder="All areas"
              value={filters.area ?? ''}
              options={areas.map((a) => ({ value: a.value, label: `${a.value} (${a.count})` }))}
              onChange={(e) => set({ area: e.target.value || undefined })}
            />
          ) : null}
          {trades.length > 0 || filters.trade ? (
            <Select
              label="Trade"
              placeholder="All trades"
              value={filters.trade ?? ''}
              options={trades.map((t) => ({
                value: t.value,
                label: `${tradeLabel(t.value)} (${t.count})`,
              }))}
              onChange={(e) => set({ trade: e.target.value || undefined })}
            />
          ) : null}
          <Select
            label="When"
            placeholder="Any time"
            value={filters.sinceDays ? String(filters.sinceDays) : ''}
            options={PHOTO_AGE_OPTIONS}
            onChange={(e) =>
              set({ sinceDays: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          {filters.tag ? (
            <p className="photo-filters__tag">
              <StatusPill tone="info">Tag: {filters.tag}</StatusPill>
              <Button variant="secondary" onClick={() => set({ tag: undefined })}>
                Clear tag
              </Button>
            </p>
          ) : null}
        </div>
      ) : null}
      {photos.data && shown.length === 0 ? (
        <p className="u-muted">
          {filtering
            ? 'No photos match these filters.'
            : 'No photos yet. Photos added to site diaries, defects, inspections and RFIs show up here.'}
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
                aria-label={`Open ${p.file.filename}, ${photoSource(p.file.module)}${
                  p.tags?.area ? `, ${p.tags.area}` : ''
                }`}
              >
                {/* Signed storage links, not static assets, so next/image can't optimise them. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!showAll && list.length > SHOWN ? (
        <p>
          <Button variant="secondary" onClick={() => setShowAll(true)}>
            Show more
          </Button>
        </p>
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
              {open.tags?.source === 'nova' ? ' · Tagged with Nova' : ''}
            </p>
            {open.tags?.tags.length ? (
              <p className="photo-filters__tag">
                {open.tags.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="photo-tag-chip"
                    aria-label={`Show photos tagged ${tag}`}
                    onClick={() => {
                      set({ tag });
                      setOpen(null);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </p>
            ) : null}
            <PhotoTagEditor
              key={open.file.id}
              orgId={orgId}
              projectId={projectId}
              photo={open}
              knownAreas={areas.map((a) => a.value)}
              onSaved={closeAndRefresh}
            />
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}
