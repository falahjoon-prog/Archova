// Site photo albums: which album a photo is in, when it counts as unfiled, and Nova's rule-based filing suggestion.
// Pure: no database, no model. The suggestion looks at photos that are already filed.
import type { PhotoCategory, PhotoRefKind } from '../infra/tables';

/** Album a photo falls into from the module it was taken in, before any filing overrides it. */
export const MODULE_CATEGORY: Readonly<Record<string, PhotoCategory>> = {
  diary: 'daily_log',
  defects: 'punch_list',
  quality: 'inspections',
  rfis: 'rfis',
};

export const categoryOfModule = (module: string): PhotoCategory =>
  MODULE_CATEGORY[module] ?? 'unclassified';

/** Nova flags a photo that has sat unfiled this long. */
export const UNCLASSIFIED_FLAG_AFTER_MS = 24 * 60 * 60_000;

export const needsReview = (
  category: PhotoCategory,
  uploadedAt: Date,
  now: Date = new Date(),
): boolean =>
  category === 'unclassified' && now.getTime() - uploadedAt.getTime() >= UNCLASSIFIED_FLAG_AFTER_MS;

export interface PhotoFacts {
  id: string;
  category: PhotoCategory;
  refKind: PhotoRefKind | null;
  refId: string | null;
  uploaderId: string | null;
  at: Date;
  lat: number | null;
  lng: number | null;
}

export interface FilingSuggestion {
  category: PhotoCategory;
  refKind: PhotoRefKind | null;
  refId: string | null;
  basedOnFileId: string;
  reason: 'same_place' | 'same_session';
}

const SAME_PLACE_M = 75;
const SAME_SESSION_MS = 30 * 60_000;

/** Metres between two points (haversine); good to a few metres at site scale. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Where an unfiled photo most likely belongs, judged from already-filed photos: one taken within 75 m of it
 * (closest wins, newest breaks ties), else one by the same person within 30 minutes. Null when nothing is close.
 */
export function suggestFiling(
  photo: PhotoFacts,
  filed: readonly PhotoFacts[],
): FilingSuggestion | null {
  let best: { f: PhotoFacts; score: number; reason: FilingSuggestion['reason'] } | null = null;
  for (const f of filed) {
    if (f.category === 'unclassified' || f.id === photo.id) continue;
    let score: number;
    let reason: FilingSuggestion['reason'];
    if (photo.lat !== null && photo.lng !== null && f.lat !== null && f.lng !== null) {
      const d = distanceM(photo.lat, photo.lng, f.lat, f.lng);
      if (d <= SAME_PLACE_M) {
        score = d;
        reason = 'same_place';
      } else continue;
    } else if (
      photo.uploaderId &&
      photo.uploaderId === f.uploaderId &&
      Math.abs(photo.at.getTime() - f.at.getTime()) <= SAME_SESSION_MS
    ) {
      score = SAME_PLACE_M + Math.abs(photo.at.getTime() - f.at.getTime()) / 60_000;
      reason = 'same_session';
    } else continue;
    if (!best || score < best.score) best = { f, score, reason };
  }
  if (!best) return null;
  return {
    category: best.f.category,
    refKind: best.f.refKind,
    refId: best.f.refId,
    basedOnFileId: best.f.id,
    reason: best.reason,
  };
}
