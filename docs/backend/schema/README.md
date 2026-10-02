# Database schema

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [backend README](../README.md)

PostgreSQL 16+ (Aurora PostgreSQL, ap-southeast-2). **One Postgres schema per module, schema name = module name** (accepted as X8 in [cross-team-decisions](../../architecture/cross-team-decisions.md)), so the table that holds RFIs is `rfis.rfis`. Kernel-owned infrastructure tables live in schema `shared`.

| File | Postgres schemas | Phase |
|---|---|---|
| [platform.md](platform.md) | `identity` (global), `platform`, `access` | 0 |
| [billing.md](billing.md) | `billing` | 0 |
| [shared.md](shared.md) | `shared` (kernel: outbox, change feed, counters, idempotency, job runs), `files`, `collaboration`, `audit`, `notifications`, `search` | 0 |
| [documents-drawings-specs.md](documents-drawings-specs.md) | `documents` (documents, drawings, specifications, transmittals) | 1 |
| [rfis-submittals-correspondence.md](rfis-submittals-correspondence.md) | `rfis`, `submittals`, `correspondence`, `meetings` | 1 |
| [field.md](field.md) | `diary`, `defects`, `photos` | 1 |
| [quality-safety.md](quality-safety.md) | `quality`, `safety` | 2 |
| [financials.md](financials.md) | `financials` | 3 |
| [later-phases.md](later-phases.md) | `ai`, `integrations`, `reporting`, `scheduling`, `precon`, `workforce` | 1–5 |

## Conventions (every table unless stated)

These implement [conventions.md §Database](../../architecture/conventions.md#database) and [data-architecture.md §2](../../architecture/data-architecture.md#2-schema-conventions). Notation in these files: `column type [constraints]`. The **standard columns** below are implied on every tenant table and not repeated.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | UUIDv7, minted by the app (mobile can mint offline). API exposes it with a type prefix (`rfi_…`) per [conventions §IDs](../../architecture/conventions.md#ids) |
| `org_id` | `uuid not null` | RLS key; first column of every composite index |
| `created_at`, `updated_at` | `timestamptz not null` | `updated_at` set by trigger |
| `created_by`, `updated_by` | `uuid` | user id (no cross-schema FK) |
| `version` | `int not null default 1` | optimistic concurrency; API `ETag` |
| `deleted_at` | `timestamptz null` | soft delete where users can restore; list indexes are partial `WHERE deleted_at IS NULL` |

Project-scoped tables also carry `project_id uuid not null`, and their indexes start `(org_id, project_id, …)`.

**Rules**
- **No cross-module foreign keys** ([data-architecture §2](../../architecture/data-architecture.md#2-schema-conventions)). References to another module's rows (`project_id`, `company_id`, `file_id`, `user_id`) are plain indexed `uuid` columns; integrity is kept by the owning module's public interface and by events (e.g. `platform.project.deleted.v1` → modules archive their rows). Within a module, FKs are required.
- **RLS on every tenant table**, created by the migration helper (see [02 §2](../02-multi-tenancy-auth-licensing.md#2-row-level-security-implementation)). CI rejects a table with `org_id` but no policy, or a table without `org_id` that is not on the global allow-list.
- **Money:** `numeric(18,2)` plus `currency char(3) default 'AUD'`. GST stored per line, never derived on read.
- **Dates vs moments:** user-picked dates (`due_date`, diary `date`) are `date`; moments are `timestamptz` UTC. The project carries its IANA `timezone` and `state`.
- **Enums:** `text` + `CHECK` (not Postgres enums).
- **Human numbers** (`RFI-042`): `number int`, unique per `(project_id)` (or per contract for claims), issued from `shared.counters` in the creating transaction.
- **Rich text:** `jsonb` editor document + a plain-text `*_text` copy for search and AI.
- **Custom fields:** `custom jsonb default '{}'` validated against `platform.custom_field_defs`; anything filtered often gets a real column.
- **Sync-relevant writes** (everything the mobile app reads) also write a `shared.change_feed` row in the same transaction (the kernel repository base class does this).
- **Migrations:** forward-only, expand → backfill in batches → contract; `CREATE INDEX CONCURRENTLY`; no locking `ALTER` on large tables.

## Large tables and partitioning

Per [data-architecture §3](../../architecture/data-architecture.md#3-large-table-strategy), managed with `pg_partman`:

| Table | Partitioning | Why |
|---|---|---|
| `audit.activity_log`, `audit.security_events` | range, monthly on `occurred_at`; 13 months hot, older → S3 Parquet (Object Lock) | ~5M rows/day at 100k users (Sam's estimate) |
| `shared.change_feed`, `shared.outbox` | range, monthly (outbox: weekly) | append-only, pruned |
| `notifications.notifications` | range, monthly; 12 months kept | |
| `integrations.webhook_deliveries`, `ai.ai_requests` | range, monthly | |
| `files.file_objects`, `photos.photos`, `diary.*` child lines | hash on `org_id`, 64 partitions | grow without bound; every query is org-scoped |
| `ai.ai_chunks` | hash on `org_id`, HNSW index per partition (X9) | vector scale path |
