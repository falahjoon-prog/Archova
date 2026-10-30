// Drawing-sheet calls that change data. Markups are private to their author until published.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { PenShape } from './ink';

export interface MarkupTarget {
  orgId: string;
  projectId: string;
  revisionId: string;
}

/** Saves the drawn strokes as one private markup. The key makes a retry after a lost response safe. */
export async function createPenMarkup(
  api: ApiClient,
  t: MarkupTarget,
  shapes: readonly PenShape[],
  idempotencyKey: string,
) {
  return unwrap(
    await api.POST(
      '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups',
      {
        params: {
          path: { orgId: t.orgId, projectId: t.projectId, drawingRevisionId: t.revisionId },
          header: { 'Idempotency-Key': idempotencyKey },
        },
        body: { visibility: 'private', shapes: shapes.map((s) => ({ ...s })) },
      },
    ),
  );
}
