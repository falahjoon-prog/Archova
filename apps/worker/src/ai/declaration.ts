// What the default worker needs to know about Nova's re-index: that it exists and which events it wants. The handler
// lives in `./reindex.ts`, which only the ai-worker bundle loads (mod-ai needs pdfjs-dist and, through identity,
// argon2, which the default worker image does not carry). This file must not import `@archova/mod-ai`.
import type { SubscriberRoute } from '../subscribers';

export const AI_REINDEX_SUBSCRIBER = 'ai.reindex-records';

/** The same list as `RECORD_EVENT_TYPES` in mod-ai (a unit test compares them): events that change a record Ask reads. */
export const AI_REINDEX_ROUTE: SubscriberRoute = {
  name: AI_REINDEX_SUBSCRIBER,
  types: ['rfis.rfi.*', 'defects.defect.*', 'diary.entry.*'],
  queue: 'ai',
};

export const AI_RESTAMP_SUBSCRIBER = 'ai.restamp-documents';

/**
 * The same list as `DOCUMENT_EVENT_TYPES` in mod-ai (a unit test compares them): events that change which revision of
 * a stored document or sheet is current, or the folder (and so the access scope) a document sits in.
 */
export const AI_RESTAMP_ROUTE: SubscriberRoute = {
  name: AI_RESTAMP_SUBSCRIBER,
  types: [
    'documents.document.updated.v1',
    'documents.document.revision.added.v1',
    'documents.drawing.revision.published.v1',
  ],
  queue: 'ai',
};

/** Everything the dispatcher routes to the ai-worker. */
export const AI_ROUTES: readonly SubscriberRoute[] = [AI_REINDEX_ROUTE, AI_RESTAMP_ROUTE];
