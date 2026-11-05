// What the default worker needs to know about Nova's re-index: that it exists and which events it wants. The handler
// lives in `./reindex.ts`, which only the ai-worker bundle loads (mod-ai needs pdfjs-dist and, through identity,
// argon2, which the default worker image does not carry). This file must not import `@archova/mod-ai`.
import type { ScheduledRoute } from '../scheduler';
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

export const ACCOUNTING_PUSH_SUBSCRIBER = 'accounting.push';

/**
 * Bills and invoices for the accounting system (integrations/02 A4, A5). It rides the ai queue only because this
 * process is the one that loads the modules (the financials and integrations interfaces); it does no AI work.
 */
export const ACCOUNTING_PUSH_ROUTE: SubscriberRoute = {
  name: ACCOUNTING_PUSH_SUBSCRIBER,
  types: ['financials.payment_schedule.issued.v1', 'financials.claim.submitted.v1'],
  queue: 'ai',
};

export const FOLDER_PUBLISH_SUBSCRIBER = 'folders.publish';

/** A newly current drawing revision, one way to the SharePoint or Drive folders linked to its project (integrations/03 M2). */
export const FOLDER_PUBLISH_ROUTE: SubscriberRoute = {
  name: FOLDER_PUBLISH_SUBSCRIBER,
  types: ['documents.drawing.revision.published.v1'],
  queue: 'ai',
};

export const ACCOUNTING_PULL_JOB = 'accounting.pull';

/**
 * Payments on the bills and invoices we pushed (integrations/02 A7), hourly. It polls rather than waiting for a webhook
 * because neither Xero nor MYOB needs a public endpoint this way. Same process as the push, for the same reason.
 */
export const ACCOUNTING_PULL_ROUTE: ScheduledRoute = {
  name: ACCOUNTING_PULL_JOB,
  cron: '10 * * * *',
  queue: 'ai',
};

/** Everything the dispatcher routes to the ai-worker. */
export const AI_ROUTES: readonly SubscriberRoute[] = [
  AI_REINDEX_ROUTE,
  AI_RESTAMP_ROUTE,
  ACCOUNTING_PUSH_ROUTE,
  FOLDER_PUBLISH_ROUTE,
];

export const AI_SWEEP_JOB = 'ai.sweep';

/** Nightly, after the busiest hours in every Australian time zone: reconciles each org's stored text with the register. */
export const AI_SWEEP_ROUTE: ScheduledRoute = {
  name: AI_SWEEP_JOB,
  cron: '20 17 * * *',
  queue: 'ai',
};

/** Everything scheduled per org that runs in the ai-worker. */
export const AI_JOBS: readonly ScheduledRoute[] = [AI_SWEEP_ROUTE, ACCOUNTING_PULL_ROUTE];
