import type { UpdateProjectRequest } from '@archova/contracts';
import { AppError } from '@archova/kernel';

type Tile = NonNullable<UpdateProjectRequest['statusTile']>;

export const RICH_DOC_MAX_CHARS = 8000;

/** Characters of text in a document, so one tile cannot be used to store a large file. */
export function richDocLength(doc: Tile['doc']): number {
  return doc.blocks.reduce(
    (n, b) => n + b.lines.reduce((m, line) => m + line.reduce((k, r) => k + r.text.length, 0), 0),
    0,
  );
}

/** The shape is checked by the contract; this adds the limit the schema cannot express. */
export function checkStatusTile(tile: Tile): void {
  if (richDocLength(tile.doc) > RICH_DOC_MAX_CHARS)
    throw new AppError('validation_failed', 'The project status text is too long.', [
      { path: 'statusTile.doc', message: `At most ${RICH_DOC_MAX_CHARS} characters` },
    ]);
}
