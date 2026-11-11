import type { components } from '@archova/contracts/openapi';

export type PhotoCategory = components['schemas']['PhotoCategory'];
export type PhotoRefKind = components['schemas']['PhotoRefKind'];
export type SitePhoto = components['schemas']['SitePhoto'];
export type PhotoAlbums = components['schemas']['PhotoAlbums'];
export type OwnAlbum = components['schemas']['PhotoAlbum'];

export const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  safety_risk: 'Safety risk',
  daily_log: 'Daily log',
  punch_list: 'Punch list',
  drawings: 'Drawings',
  inspections: 'Inspections',
  rfis: 'RFIs',
  unclassified: 'Unclassified',
};

export const REF_LABELS: Record<PhotoRefKind, string> = {
  rfi: 'an RFI',
  defect: 'a punch item',
  observation: 'an observation',
  inspection: 'an inspection',
  diary_entry: 'a diary entry',
  drawing_revision: 'a drawing',
};

export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as PhotoCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const SUGGESTION_REASONS = {
  same_place: 'taken at the same spot as a photo already filed there',
  same_session: 'taken by the same person within minutes of a photo filed there',
} as const;

export const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';
export const PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/** The day a photo belongs to on the timeline, in the project's time zone. */
export const photoInstant = (p: SitePhoto) => p.file.capture?.takenAt ?? p.file.createdAt;
