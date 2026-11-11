'use client';

import { formatInstant } from '@/shared/lib/format';
import { CATEGORY_LABELS, photoInstant, type SitePhoto } from '../lib/types';

/** Square tiles with the album as a caption; photos Nova wants filed carry a marker. */
export function PhotoGrid({
  photos,
  timeZone,
  onOpen,
  label,
}: {
  photos: readonly SitePhoto[];
  timeZone: string;
  onOpen: (p: SitePhoto) => void;
  label: string;
}) {
  return (
    <ul className="photo-tiles" aria-label={label}>
      {photos.map((p) => (
        <li key={p.file.id}>
          <button
            type="button"
            className="photo-tiles__tile"
            onClick={() => onOpen(p)}
            aria-label={`Open ${p.file.filename}, ${CATEGORY_LABELS[p.category]}`}
          >
            {/* Signed storage links, not static assets, so next/image can't optimise them. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" loading="lazy" />
            {p.needsReview ? <span className="photo-tiles__flag">Needs filing</span> : null}
          </button>
          <p className="photo-tiles__caption u-caption">
            {CATEGORY_LABELS[p.category]} · {formatInstant(photoInstant(p), timeZone)}
          </p>
        </li>
      ))}
    </ul>
  );
}
