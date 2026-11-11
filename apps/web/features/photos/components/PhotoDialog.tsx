'use client';

import { Alert, Button, Dialog, Select } from '@archova/ui';
import { formatInstant } from '@/shared/lib/format';
import { usePhotoMutations, usePhotoAlbums } from '../hooks/usePhotos';
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  REF_LABELS,
  SUGGESTION_REASONS,
  photoInstant,
  type PhotoCategory,
  type SitePhoto,
} from '../lib/types';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';

/** One photo large, where it is filed, Nova's suggestion if it is unfiled, and the controls to file it or add it to an album. */
export function PhotoDialog({
  photo,
  timeZone,
  onClose,
}: {
  photo: SitePhoto | null;
  timeZone: string;
  onClose: () => void;
}) {
  const m = usePhotoMutations();
  const albums = usePhotoAlbums();
  const own = albums.data?.own ?? [];
  const s = photo?.suggestion;
  const error = m.file.error ?? m.addToAlbum.error;
  return (
    <Dialog open={photo !== null} onClose={onClose} title={photo?.file.filename ?? 'Photo'}>
      {photo ? (
        <div className="stack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="photo-grid__full" src={photo.url} alt={photo.file.filename} />
          <p className="u-caption">
            {CATEGORY_LABELS[photo.category]}
            {photo.filing?.refKind ? ` · linked to ${REF_LABELS[photo.filing.refKind]}` : ''} ·{' '}
            {formatInstant(photoInstant(photo), timeZone)}
          </p>
          {photo.needsReview && !s ? (
            <Alert tone="warning" title="Nova: this photo has been unfiled for over a day">
              Nothing similar is filed yet, so pick an album below.
            </Alert>
          ) : null}
          {s ? (
            <Alert
              tone={photo.needsReview ? 'warning' : 'info'}
              title={`Nova suggests ${CATEGORY_LABELS[s.category]}${s.refKind ? `, on ${REF_LABELS[s.refKind]}` : ''}`}
            >
              <p>This was {SUGGESTION_REASONS[s.reason]}.</p>
              <Button
                size="sm"
                disabled={m.file.isPending}
                onClick={() =>
                  m.file.mutate(
                    {
                      fileId: photo.file.id,
                      category: s.category,
                      refKind: s.refKind,
                      refId: s.refId,
                      fromSuggestion: true,
                    },
                    { onSuccess: onClose },
                  )
                }
              >
                File it there
              </Button>
            </Alert>
          ) : null}
          <ErrorAlert error={error} title="We couldn't update the photo" />
          <Select
            label="File under"
            value={photo.category}
            options={CATEGORY_OPTIONS}
            disabled={m.file.isPending}
            onChange={(e) =>
              m.file.mutate(
                { fileId: photo.file.id, category: e.target.value as PhotoCategory },
                { onSuccess: onClose },
              )
            }
          />
          {own.length > 0 ? (
            <Select
              label="Add to your album"
              value=""
              placeholder="Choose an album"
              options={own.map((a) => ({ value: a.id, label: a.name }))}
              disabled={m.addToAlbum.isPending}
              onChange={(e) =>
                e.target.value &&
                m.addToAlbum.mutate(
                  { albumId: e.target.value, fileId: photo.file.id },
                  { onSuccess: onClose },
                )
              }
            />
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
