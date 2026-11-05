// Drawing-sheet changes made on the phone (mobile 02 §2.4, 03 §3.4). A markup is saved to the device first and
// sent when there is signal; markups are private to their author until published.

import { encodeId, uuidv7 } from '@archova/domain';
import type { Markup } from '@archova/contracts';
import type { SqliteSyncStore } from '../../lib/db/sync-store';
import type { PenShape } from './ink';

export const MARKUP_ENTITY = 'drawing_markup';

export interface MarkupTarget {
  projectId: string;
  revisionId: string;
}

export interface SavePenMarkupInput extends MarkupTarget {
  shapes: readonly PenShape[];
  /** Id of the queued command; a retry after a lost response is safe because the server remembers it. */
  mutationId: string;
  clientAt: string;
}

/**
 * Saves the drawn strokes as one private markup: shown at once from the device, sent as `drawings.createMarkup`.
 * The device picks the markup's id, so the next pull confirms this very record rather than adding a second one.
 */
export async function savePenMarkup(
  store: SqliteSyncStore,
  input: SavePenMarkupInput,
): Promise<{ markupId: string }> {
  if (input.shapes.length === 0) throw new Error('Draw something before saving');
  const markupId = encodeId('markup', uuidv7());
  const shapes = input.shapes.map((s) => ({ ...s }));
  const record: Markup = {
    id: markupId,
    projectId: input.projectId,
    revisionId: input.revisionId,
    // The author is filled in by the next pull; every markup the device holds is visible to its owner.
    ownerId: '',
    ownerCompanyId: null,
    visibility: 'private',
    shapes: shapes as unknown as Markup['shapes'],
    copiedFromId: null,
    needsLocationCheck: false,
    publishedAt: null,
    createdAt: input.clientAt,
    updatedAt: input.clientAt,
    version: 1,
  };
  await store.write(
    { entityType: MARKUP_ENTITY, id: markupId, data: record },
    {
      mutationId: input.mutationId,
      command: 'drawings.createMarkup',
      projectId: input.projectId,
      baseVersion: null,
      clientAt: input.clientAt,
      payload: { revisionId: input.revisionId, visibility: 'private', shapes },
      dependsOn: [],
    },
  );
  return { markupId };
}

/** Markups on one revision that this device holds: its own, its company's and the published ones. */
export async function listRevisionMarkups(
  store: SqliteSyncStore,
  projectId: string,
  revisionId: string,
): Promise<Markup[]> {
  const rows = await store.listRecords<Markup>(MARKUP_ENTITY, projectId, {
    '$.revisionId': revisionId,
  });
  return rows.map((r) => r.data);
}
