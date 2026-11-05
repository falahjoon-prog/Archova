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
  const rows = await store.listRecords<StoredMarkup>(MARKUP_ENTITY, projectId, {
    '$.revisionId': revisionId,
  });
  // A markup deleted on this device stays out of sight while the delete waits to be sent.
  return rows.filter((r) => !r.data.deletedOnDevice).map((r) => r.data);
}

/** A markup as held on the device: the server's fields plus a mark for a delete not yet sent. */
export type StoredMarkup = Markup & { deletedOnDevice?: true };

/**
 * Whether the person may still change this markup: not once it is published (that is the record), and only their
 * own. A markup the device has not sent yet has no author on file, and a private one is only ever its author's.
 */
export function canChangeMarkup(markup: Markup, meId: string | null): boolean {
  if (markup.visibility === 'project') return false;
  return markup.visibility === 'private' || markup.ownerId === '' || markup.ownerId === meId;
}

export type ChangeMarkup =
  { kind: 'shapes'; shapes: readonly PenShape[] } | { kind: 'publish' } | { kind: 'delete' };

export type ChangeMarkupResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'published' | 'no_shapes' };

/**
 * Edits, publishes or deletes a markup from the device: shown at once, sent as `drawings.updateMarkup` or
 * `drawings.deleteMarkup` against the version the device last saw. A markup still waiting to be created is changed
 * after its create is sent, so the edit never reaches the server first.
 */
export async function changeMarkup(
  store: SqliteSyncStore,
  input: { markupId: string; change: ChangeMarkup; mutationId: string; clientAt: string },
): Promise<ChangeMarkupResult> {
  const held = await store.get(MARKUP_ENTITY, input.markupId);
  if (!held) return { ok: false, reason: 'not_found' };
  const markup = held.data as StoredMarkup;
  if (markup.deletedOnDevice) return { ok: false, reason: 'not_found' };
  if (markup.visibility === 'project') return { ok: false, reason: 'published' };
  const { change } = input;
  if (change.kind === 'shapes' && change.shapes.length === 0)
    return { ok: false, reason: 'no_shapes' };
  const earlier = (await store.listOutbox())
    .filter((e) => e.entityType === MARKUP_ENTITY && e.entityId === input.markupId)
    .map((e) => e.mutationId);
  const next: StoredMarkup =
    change.kind === 'shapes'
      ? { ...markup, shapes: change.shapes.map((s) => ({ ...s })) as unknown as Markup['shapes'] }
      : change.kind === 'publish'
        ? { ...markup, visibility: 'project', publishedAt: input.clientAt }
        : { ...markup, deletedOnDevice: true };
  next.updatedAt = input.clientAt;
  await store.write(
    { entityType: MARKUP_ENTITY, id: input.markupId, data: next },
    {
      mutationId: input.mutationId,
      command: change.kind === 'delete' ? 'drawings.deleteMarkup' : 'drawings.updateMarkup',
      projectId: markup.projectId,
      baseVersion: held.version,
      clientAt: input.clientAt,
      payload:
        change.kind === 'shapes'
          ? { shapes: next.shapes }
          : change.kind === 'publish'
            ? { visibility: 'project' }
            : {},
      dependsOn: earlier,
    },
  );
  return { ok: true };
}
