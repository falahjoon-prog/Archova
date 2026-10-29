# apps/worker

Background job processors (BullMQ on Valkey, X19). Loads the same modules as `apps/api`; no business logic of its own. Owner: Ben. Design: [docs/backend/05-background-jobs.md](../../docs/backend/05-background-jobs.md).

## What is built

- **Outbox relay** (`src/relay.ts`): locks unpublished `shared.outbox` rows with `FOR UPDATE SKIP LOCKED`, enqueues them on `events` (`jobId = eventId`), marks them published in the same transaction. At-least-once; several relays can run in parallel.
- **Dispatcher** (`src/queues.ts`): fans each event to every matching subscriber as its own job on `subscribers` (`jobId = eventId.subscriber`; BullMQ forbids `:`). Subscribers are registered in `src/main.ts` and must be idempotent on `event.id`.
- **Nova re-index** (`src/ai/`, `src/ai.ts`): keeps the Ask and search index in step with RFIs, defects and diary days. See below.
- Subscribers read the full event as the tenant (`loadEvent`, app_rw, `withTenantTx`), so the relay never sees payloads.

## The ai-worker (Nova's index)

A second entry, `src/ai.ts` → `dist/ai.js`, runs from the `ai-worker` image (`WORKER_ROLE=ai`; `pnpm --filter @archova/worker dev:ai` locally). It loads the modules as the API does (`@archova/compose`), so it alone needs pdf.js and argon2; `dist/main.js` never imports them (`test/unit/ai-routing.test.ts` bundles `main.ts` and fails if it ever does). It has no relay, dispatcher or scheduled jobs and no `DATABASE_PLATFORM_URL`; it needs `DATABASE_URL`, `REDIS_URL` and the API's `API_AI_*` settings (`loadAiConfig`, so the same Australian-region and model checks apply, X25).

The default worker's dispatcher routes every `rfis.rfi.*`, `defects.defect.*` and `diary.entry.*` event to the `subscribers-ai` queue (`src/ai/declaration.ts` is the only AI code it holds; a test keeps its list equal to `RECORD_EVENT_TYPES` in mod-ai). Events wait there until an ai-worker runs, then:

1. **At once**, subscriber `ai.reindex-records`: `dropStaleRecord` deletes whatever stored text no longer matches the register, in the event's own org, with no model call and whatever the plan. A voided or deleted record, or a day sent back to draft, stops being searchable here.
2. **After about a minute**, queue `ai-reindex`: if the record is still a source, one delayed job per record per 60 s window (job id `org.kind.record.window`, so a burst of edits is one run that reads the latest text) calls `reindexRecord`. It is skipped for a deleted org, a `read_only` or `cancelled` plan, and when Nova is off (`entitlement-required`, `ai.disabled`, `ai.feature_disabled`); any other error retries with backoff.

Both stages act as `AI_INDEX_ACTOR`, a reserved id in no project with no org role: every `access.can` fails for it, so nothing it does can read as a person's. Logs carry ids and counts only, never record text. Not covered yet: documents and drawings, whose chunks take their access scope when indexed (follow-up before use beyond the pilot).

## Database access

The relay connects as `app_platform` (`DATABASE_PLATFORM_URL`, NOBYPASSRLS). Migration `20261028150000_outbox_relay_grants.sql` gives it `SELECT (id, org_id, type, occurred_at, published_at)` and `UPDATE (published_at)` on `shared.outbox` only, with an update policy that lets it set `published_at` on unpublished rows and nothing else. Subscribers use `DATABASE_URL` (app_rw). `REDIS_URL` is the job Redis. File jobs (the threat move) are scheduled only when `WORKER_FILES_STORE=s3`, with `WORKER_FILES_BUCKET`, `WORKER_FILES_REGION`, and for non-AWS storage `WORKER_S3_ENDPOINT`, `WORKER_S3_ACCESS_KEY_ID`, `WORKER_S3_SECRET_ACCESS_KEY`. The task role needs get/put/delete on `quarantine/` and put on `threats/`.

## Not built yet

Standard subscribers (audit, notifications, search-index, ...), scheduled jobs, the files pipeline moved out of the API, PDF export.
