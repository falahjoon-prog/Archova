import { webRoutes } from '@archova/routes';
import type { Citation } from '@archova/ui';
import type { NovaReference } from './types';

/** Nova's references as citations that open the drawing, RFI or documents they came from. */
export function referenceCitations(
  references: NovaReference[],
  orgSlug: string,
  projectId: string,
): Citation[] {
  return references.map((r) => ({
    id: r.id,
    label: r.label,
    href:
      r.kind === 'drawing'
        ? webRoutes.drawing(orgSlug, projectId, r.sourceId, r.revisionId)
        : r.kind === 'rfi'
          ? webRoutes.rfi(orgSlug, projectId, r.sourceId)
          : webRoutes.documents(orgSlug, projectId),
  }));
}
