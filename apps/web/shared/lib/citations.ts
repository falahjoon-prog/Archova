import { webRoutes } from '@archova/routes';
import type { Citation } from '@archova/ui';

/**
 * Nova citations arrive as record references (`drawing:<sheetId>:<revisionId>`, `documents:<documentId>`,
 * `rfi:<rfiId>`, `defect:<id>`, `diary:<date>`) so the source never needs to know the org slug; this turns them into app routes. Anything else is
 * passed through unchanged.
 */
export function resolveCitation(citation: Citation, orgSlug: string, projectId: string): Citation {
  const [kind, a, b] = citation.href.split(':');
  switch (kind) {
    case 'drawing':
      return a ? { ...citation, href: webRoutes.drawing(orgSlug, projectId, a, b) } : citation;
    case 'documents':
      return {
        ...citation,
        href: `${webRoutes.documents(orgSlug, projectId)}${a ? `?doc=${encodeURIComponent(a)}` : ''}`,
      };
    case 'rfi':
      return a ? { ...citation, href: webRoutes.rfi(orgSlug, projectId, a) } : citation;
    case 'defect':
      return a ? { ...citation, href: webRoutes.defect(orgSlug, projectId, a) } : citation;
    case 'diary':
      return a ? { ...citation, href: webRoutes.diary(orgSlug, projectId, a) } : citation;
    case 'module': {
      // A lookup that covers a whole list (overdue RFIs, budget checks) links to that module's screen.
      const to: Record<string, (o: string, p: string) => string> = {
        rfis: webRoutes.rfis,
        defects: webRoutes.defects,
        budget: webRoutes.budget,
        programme: webRoutes.programme,
      };
      const f = a ? to[a] : undefined;
      return f ? { ...citation, href: f(orgSlug, projectId) } : citation;
    }
    default:
      return citation;
  }
}
