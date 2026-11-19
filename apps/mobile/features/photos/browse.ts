// The project's photo albums on the phone, read online. Filing and album editing stay on the web.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';

export type PhotoCategory = components['schemas']['PhotoCategory'];

export const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  safety_risk: 'Safety risk',
  daily_log: 'Daily log',
  punch_list: 'Punch list',
  drawings: 'Drawings',
  inspections: 'Inspections',
  rfis: 'RFIs',
  unclassified: 'Unclassified',
};

export interface PhotoTarget {
  orgId: string;
  projectId: string;
}

export async function listPhotoAlbums(api: ApiClient, t: PhotoTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/photo-albums', {
      params: { path: { orgId: t.orgId, projectId: t.projectId } },
    }),
  );
}

export async function browsePhotos(api: ApiClient, t: PhotoTarget, album?: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/photos/browse', {
      params: {
        path: { orgId: t.orgId, projectId: t.projectId },
        query: { limit: 60, ...(album ? { album } : {}) },
      },
    }),
  ).data;
}

/** "12 photos", "1 photo", with how many have waited a day unfiled. */
export function albumSubtitle(count: number, needsReview = 0): string {
  const base = `${count} ${count === 1 ? 'photo' : 'photos'}`;
  return needsReview > 0 ? `${base}, ${needsReview} to file` : base;
}

/** The line under a photo: its name, and where Nova thinks an unfiled one belongs. */
export function photoSubtitle(p: {
  file: { filename: string };
  needsReview: boolean;
  suggestion: { category: PhotoCategory } | null;
}): string {
  const name = p.file.filename;
  if (p.suggestion) return `${name}. Looks like ${CATEGORY_LABELS[p.suggestion.category]}`;
  return p.needsReview ? `${name}. Not filed yet` : name;
}
