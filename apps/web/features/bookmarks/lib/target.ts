import { webRoutes } from '@archova/routes';
import type { Bookmark } from '../data/api';

export const bookmarkLabel: Record<Bookmark['entityType'], string> = {
  rfi: 'RFI',
  submittal: 'Submittal',
  defect: 'Defect',
  drawing_sheet: 'Drawing',
  meeting: 'Meeting',
};

export function bookmarkTarget(orgSlug: string, b: Bookmark): string {
  switch (b.entityType) {
    case 'rfi':
      return webRoutes.rfi(orgSlug, b.projectId, b.entityId);
    case 'submittal':
      return webRoutes.submittal(orgSlug, b.projectId, b.entityId);
    case 'defect':
      return webRoutes.defect(orgSlug, b.projectId, b.entityId);
    case 'drawing_sheet':
      return webRoutes.drawing(orgSlug, b.projectId, b.entityId);
    case 'meeting':
      return webRoutes.meeting(orgSlug, b.projectId, b.entityId);
  }
}
