// Which module events change what Nova has stored about a document or a drawing sheet without changing its text:
// a document moved to another folder (its access scope), and a new revision of a document or sheet (the old one is no
// longer current).

export const DOCUMENT_EVENT_TYPES = [
  'documents.document.updated.v1',
  'documents.document.revision.added.v1',
  'documents.drawing.revision.published.v1',
] as const;

/**
 * The id the chunks of the document or drawing sheet carry as their source: the document for a document event, the
 * sheet (not the revision) for a publish. Null for any other event, or one that does not say.
 */
export function documentSourceOf(event: {
  type: string;
  entityId: string;
  data: unknown;
}): string | null {
  if (
    event.type === 'documents.document.updated.v1' ||
    event.type === 'documents.document.revision.added.v1'
  ) {
    return event.entityId;
  }
  if (event.type === 'documents.drawing.revision.published.v1') {
    const sheetId = (event.data as { sheetId?: unknown } | null)?.sheetId;
    return typeof sheetId === 'string' && sheetId ? sheetId : null;
  }
  return null;
}
