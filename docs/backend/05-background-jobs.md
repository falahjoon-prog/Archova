# 05. Background jobs and events

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

Architecture rules: [backend-modules §4–5](../architecture/backend-modules.md#4-inter-module-communication). Anything slow, scheduled, retried or fanned out runs in `apps/worker` on **BullMQ / Redis** (a Redis cluster separate from the cache, so eviction never drops jobs). Workers are stateless Fargate services, one deployment per queue group, autoscaled on queue depth and oldest-job age.

## 1. Outbox and domain events

1. A use case writes its rows **and** its events (`shared.outbox`) in one transaction. Rolled-back work never emits events; committed work always does.
2. **Outbox relay** (in `apps/worker`, leader-elected, several in parallel by `org_id` hash range): `SELECT … WHERE published_at IS NULL ORDER BY occurred_at LIMIT 500 FOR UPDATE SKIP LOCKED`, enqueue onto `events`, mark published. Lag target < 1 s p95.
3. **Dispatcher** fans each event out to every registered subscriber as its own job (`jobId = eventId:subscriber`), so a slow subscriber can't block the others.
4. Delivery is at-least-once; every subscriber is idempotent on `event_id`.

Envelope: Ava's ([backend-modules §4](../architecture/backend-modules.md#event-bus)), type `<module>.<entity>.<verb>.v<n>`, schemas published in `packages/contracts/events/`.

Standard subscribers: `audit` (batch-writes `audit.activity_log` with the hash chain), `notifications`, `search-index`, `ai` (ingestion), `integrations` (webhooks), `realtime` (publishes "changed" hints on Redis pub/sub for `apps/realtime`), `reporting`.

Upgrade path: the relay can publish to MSK or EventBridge + SQS instead of BullMQ; the outbox and envelope don't change.

## 2. Queues

Ava's base set plus three backend-specific queues for heavy or bursty work. Each has its own concurrency and scaling target.

| Queue | Priority | Work | Notes |
|---|---|---|---|
| `events` | high | outbox fan-out | tiny jobs |
| `default` | high | notification fan-out, in-app writes, push, small module jobs | |
| `email` | high | transactional + digest emails | provider outages don't block in-app |
| `files` | medium | virus scan, metadata, thumbnails, previews | CPU bound |
| `drawings` | medium | split sets, rasterise, deep-zoom tiles, auto-hyperlinks | memory heavy, larger tasks, per-org concurrency cap |
| `pdf-export` | medium | RFI/minutes/diary/claim PDFs, evidence packs, bulk exports | headless Chromium |
| `search-index` | low | OpenSearch upserts from change feed | |
| `ai` | low (interactive AI is not a job) | extraction, chunking, embeddings, title blocks, tagging, digests | Ari's governor pauses it when interactive latency rises. Built so far: `subscribers-ai` (record change events, consumed by the ai-worker only) and `ai-reindex` (one delayed embedding job per record per minute); see `apps/worker/README.md` |
| `webhooks` | low | outbound deliveries | per-endpoint concurrency 1–5 |
| `integrations` | low | Xero/MYOB sync | per-connection lock |
| `scheduled` | — | cron fan-outs (below) | |
| `maintenance` | lowest | partitions, usage roll-ups, cleanup | |

**Fairness:** `drawings`, `pdf-export`, `ai` and `integrations` use BullMQ group concurrency keyed by `org_id`, so one tenant's 10,000-sheet import can't starve others.

## 3. Scheduled jobs

Repeatable jobs, one instance cluster-wide (fixed `jobId`). Scans that cross tenants are **platform jobs** (`app_platform`, narrow views only) that fan out per-org tenant jobs; nothing in api/worker uses `BYPASSRLS`.

**Exception:** the outbox relay (§1) connects as `app_platform` with column-limited `SELECT (id, org_id, type, occurred_at, published_at)` and `UPDATE (published_at)` on `shared.outbox`, plus two narrow policies; it never reads payloads. Approved by Sam on PR #73.

| Job | When | What |
|---|---|---|
| `financials.sopa-deadlines` | every 15 min | From `financials.v_open_claim_deadlines`, find schedules/payments due within 5, 2, 1, 0 business days in the project's state and timezone; notify the responsible party; escalate to admins on the day. **Runs in every subscription state.** Missed run → page. |
| `rfis.due` / `submittals.due` | hourly | ball-in-court reminders, due today / overdue |
| `defects.overdue` | 07:00 project tz | summary per assignee company |
| `notifications.digest` | 07:00 user tz | bundle digest notifications into one email |
| `diary.reminder` | 15:30 project tz | today's diary not submitted |
| `diary.weather` | 23:00 project tz | fill weather for the day |
| `safety.expiries` | daily | inductions, SWMS, insurances, licences expiring in 30/7/0 days |
| `billing.acv` | nightly | tracked ACV → `billing.acv_snapshots`; 90/100/110% notices |
| `billing.usage` | hourly | storage, API calls, active workers → `billing.usage_records` |
| `billing.reconcile` | daily | compare with billing provider, fix drift |
| `billing.overrides-expire` | hourly | expire overrides → recompute entitlements |
| `audit.anchor` | hourly | latest chain hash per org → S3 Object Lock (Sam 07 §4) |
| `audit.verify` | weekly | re-walk chains, report breaks |
| `files.orphans` | daily | expire upload sessions not completed after 24 h, delete quarantine objects |
| `maintenance.partitions` | daily | `pg_partman` run; detach + archive old partitions to S3 Parquet |
| `identity.prune` | daily | expired sessions, devices not seen in 60 days |
| `financials.public-holidays` | yearly + manual | load next year's holidays per state |

## 4. Reliability rules

- **Retries:** exponential backoff with jitter, 5 attempts by default, 10 for external providers; validation and permission errors fail immediately.
- **Dead letters:** final failures stay in the failed set with an alert; an admin endpoint replays them.
- **Idempotency:** deterministic job ids (`sopa:{claimId}:{threshold}`), idempotent handlers.
- **Timeouts** per queue; stalled jobs reclaimed; long jobs chunked and report progress to `shared.job_runs`.
- **Tenant context:** tenant jobs run in `withTenantTx` exactly like API requests ([02 §2](02-multi-tenancy-auth-licensing.md#2-row-level-security-implementation)).
- **Entitlements:** jobs doing billable work for a module (AI, PDFs) check the org's entitlements first; SOPA reminders are exempt and always run.
- **Graceful shutdown** on SIGTERM: stop taking jobs, finish in-flight ones.
- **Metrics:** depth and oldest-job age per queue, failure rate, outbox lag; SOPA job failures page on-call.
