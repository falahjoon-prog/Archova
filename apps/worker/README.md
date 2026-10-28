# apps/worker

Background job processors (BullMQ on Valkey, X19). Loads the same modules as `apps/api`; no business logic of its own. Owner: Ben. Design: [docs/backend/05-background-jobs.md](../../docs/backend/05-background-jobs.md).

## What is built

- **Outbox relay** (`src/relay.ts`): locks unpublished `shared.outbox` rows with `FOR UPDATE SKIP LOCKED`, enqueues them on `events` (`jobId = eventId`), marks them published in the same transaction. At-least-once; several relays can run in parallel.
- **Dispatcher** (`src/queues.ts`): fans each event to every matching subscriber as its own job on `subscribers` (`jobId = eventId.subscriber`; BullMQ forbids `:`). Subscribers are registered in `src/main.ts` and must be idempotent on `event.id`.
- Subscribers read the full event as the tenant (`loadEvent`, app_rw, `withTenantTx`), so the relay never sees payloads.

## Database access

The relay connects as `app_platform` (`DATABASE_PLATFORM_URL`, NOBYPASSRLS). Migration `20261028150000_outbox_relay_grants.sql` gives it `SELECT (id, org_id, type, occurred_at, published_at)` and `UPDATE (published_at)` on `shared.outbox` only, with an update policy that lets it set `published_at` on unpublished rows and nothing else. Subscribers use `DATABASE_URL` (app_rw). `REDIS_URL` is the job Redis. File jobs (the threat move) are scheduled only when `WORKER_FILES_STORE=s3`, with `WORKER_FILES_BUCKET`, `WORKER_FILES_REGION`, and for non-AWS storage `WORKER_S3_ENDPOINT`, `WORKER_S3_ACCESS_KEY_ID`, `WORKER_S3_SECRET_ACCESS_KEY`. The task role needs get/put/delete on `quarantine/` and put on `threats/`.

## Not built yet

Standard subscribers (audit, notifications, search-index, ...), scheduled jobs, the files pipeline moved out of the API, PDF export.
