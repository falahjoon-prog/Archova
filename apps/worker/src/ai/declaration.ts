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
