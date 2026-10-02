# Schema: kernel (`shared`) and cross-cutting modules

Cross-cutting capabilities are separate modules addressed polymorphically by `(entity_type, entity_id)` ([backend-modules §2](../../architecture/backend-modules.md#2-module-catalogue-and-boundaries)). Feature modules register their entity types (`rfi`, `defect`, `drawing_revision`, `payment_claim` …) and a permission resolver with `access`.

## shared (owned by `packages/kernel`)

**shared.outbox** — transactional outbox ([05 §1](../05-background-jobs.md#1-outbox-and-domain-events))
- `id uuid` (= `event_id`), `org_id`, `type text` (`rfis.rfi.closed.v1`), `project_id null`, `entity_type`, `entity_id`, `entity_version int`, `actor jsonb`, `data jsonb`, `trace_id`, `occurred_at`, `published_at null`
- partial index `(occurred_at) WHERE published_at IS NULL`; weekly partitions, dropped after 14 days

**shared.change_feed** — what mobile sync, search indexers and read models replay ([data-architecture §6](../../architecture/data-architecture.md#6-change-feed-for-sync-webhooks-and-read-models))
- `org_id`, `seq bigint` (per-org, from `shared.org_sequences`), `project_id null`, `module text`, `entity_type`, `entity_id`, `op text CHECK (upsert|delete|access_revoked)`, `version int`, `scope_company_id uuid null`, `is_private bool`, `at`
- PK `(org_id, seq)`; written by the same transaction as the change
- `access_revoked` rows are written when a project member is removed or loses a tool, and drive `revokedScopes` in sync pull (X14)

**shared.org_sequences** — `org_id PK`, `last_seq bigint`; incremented with `UPDATE … RETURNING` (row lock is per org, so tenants never contend with each other)

**shared.counters** — per-project human numbering: PK `(project_id, entity_type)`, `org_id`, `next_value int`; `UPDATE … SET next_value = next_value + 1 RETURNING` in the creating transaction

**shared.idempotency_keys** — PK `(org_id, principal_id, key)`, `request_hash char(64)`, `status int`, `response jsonb`, `expires_at` (24 h). Hot path in Redis; Postgres copy only for mutations that must survive a Redis failover (sync push, claims).

**shared.job_runs** — progress for long jobs the UI shows ([backend-modules §5](../../architecture/backend-modules.md#5-background-jobs)): `kind`, `status text CHECK (queued|running|succeeded|failed|cancelled)`, `progress numeric(5,2)`, `total int`, `done int`, `result jsonb`, `result_file_id null`, `error jsonb`, `started_at`, `finished_at`, `requested_by`

**shared.devices** — push targets (X13). Owned by `notifications`; kept in `shared` under the name the team agreed.
- `user_id`, `org_id`, `session_id uuid` (→ `identity.sessions.id`; identity sits in the global layer, so this is enforced by the `identity.session.revoked.v1` event rather than a DB FK), `device_id text` (stable per install)
- `platform text CHECK (ios|android)`, `push_token text`, `app_version`, `locale`, `timezone`, `last_seen_at`, `revoked_at`
- unique `(org_id, device_id)`; pruned when `last_seen_at` > 60 days

## files

**files.upload_sessions** — `id` (API `upl_…`), `project_id null`, `filename`, `mime`, `size_bytes`, `sha256`, `multipart_upload_id null`, `quarantine_key`, `status text CHECK (pending|uploaded|expired)`, `expires_at`
**files.file_objects** (hash-partitioned by `org_id`)
- `project_id null`, `module text`, `storage_key text unique`, `filename`, `mime`, `size_bytes bigint`, `sha256 char(64)`
- `status text CHECK (scanning|ready|infected|failed)`, `width`, `height`, `page_count`, `taken_at`, `geo geography(point)`
- `renditions jsonb` (`{"thumb_256": key, "preview_1600": key, "tiles": prefix}`), `legal_hold bool`, `dedupe_of uuid null`
- index `(org_id, sha256)` for per-org dedupe

## collaboration

**collaboration.attachments** — `project_id`, `entity_type`, `entity_id`, `file_id`, `caption`, `sort`; index `(org_id, entity_type, entity_id)`
**collaboration.comments** — `project_id`, `entity_type`, `entity_id`, `parent_id null`, `body jsonb`, `body_text`, `edited_at`
**collaboration.mentions** — `comment_id null`, `entity_type`, `entity_id`, `mentioned_user_id`
**collaboration.watchers** — `entity_type`, `entity_id`, `user_id`, `reason text CHECK (creator|assignee|mentioned|manual|distribution)`; unique on those four
**collaboration.distribution_lists** — `project_id`, `name`, `user_ids uuid[]`, `company_ids uuid[]`

## audit (Sam [07-audit-logging.md](../../security-licensing/07-audit-logging.md))

Written by the `audit` subscriber from outbox events in batches, so audit never slows a user action and is never lost. `app_rw` has `INSERT`/`SELECT` only; a trigger rejects `UPDATE`/`DELETE` for every role except the retention-purge role (partition drops only).

**audit.activity_log** and **audit.security_events** (same shape, Sam 07 §3; monthly partitions)
- `id`, `org_id`, `project_id null`, `occurred_at`, `actor_type text CHECK (user|api_client|system|support)`, `actor_id`, `on_behalf_of null`
- `ip inet`, `user_agent`, `client text CHECK (web|ios|android|api)`, `action text` (`rfi.response.created`), `target_type`, `target_id`
- `changes jsonb` (`{field: [before, after]}`, sensitive fields redacted), `metadata jsonb` (`ai_assisted: true`), `request_id`
- `prev_hash bytea`, `hash bytea` — chain per org; the batch writer takes a per-org advisory lock
- index `(org_id, target_type, target_id, occurred_at desc)`

**audit.chain_anchors** — hourly latest hash per org, also written to S3 Object Lock: `org_id`, `anchored_at`, `last_event_id`, `hash`, `s3_key`
**audit.evidence_records** (Sam 07 §5) — `project_id`, `entity_type`, `entity_id`, `version int`, `pdf_key`, `json_key`, `sha256_pdf`, `sha256_json`, `issued_at`, `issued_by`, `recipients jsonb`, `supersedes_id null`
**audit.legal_holds** — `project_id`, `placed_by`, `reason`, `placed_at`, `released_at`

## notifications

**notifications.notifications** (monthly partitions) — `user_id`, `project_id`, `kind`, `entity_type`, `entity_id`, `title`, `body`, `data jsonb`, `read_at`, `emailed_at`, `pushed_at`; index `(user_id, read_at, created_at desc)`
**notifications.preferences** — `user_id`, `project_id null`, `kind`, `channels text[]` (`in_app|email|push|sms`), `digest text CHECK (instant|daily|off)`, `quiet_hours jsonb`. SOPA deadline kinds cannot be set to `off` (Uma's rule).
**notifications.email_messages** — `notification_id null`, `to`, `template`, `provider_message_id`, `status`, `delivered_at`, `opened_at` (delivery receipts for evidence)

## search

OpenSearch holds the index ([data-architecture §1](../../architecture/data-architecture.md#1-data-stores)); Postgres FTS (`tsvector` columns on feature tables) is the phase 0–1 fallback. **search.index_state** — `org_id`, `index_name`, `last_seq bigint` (position in `shared.change_feed` the indexer has consumed) for rebuild/replay.
