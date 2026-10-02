# Data architecture

**Owner:** Ava (stores and rules), Ben (schemas), Owen (operation) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Data stores

| Store | Service | Holds | Notes |
|---|---|---|---|
| Primary relational | **Amazon Aurora PostgreSQL 16+** | All transactional data, outbox, change log, audit log (hot), embeddings (pgvector) | Writer + 2–5 read replicas per cell; RLS on all tenant tables |
| Connection pooling | **RDS Proxy** or PgBouncer (transaction mode) | — | `SET LOCAL` tenant context is transaction-scoped so it is pooler-safe |
| Cache, queues, rate limits | **ElastiCache Redis (cluster mode)** | Entitlements, permission cache, sessions metadata, BullMQ queues, idempotency keys | Separate clusters for cache vs queues so eviction never drops jobs |
| Object storage | **S3** (+ CloudFront signed URLs) | Documents, drawings, photos, renditions, exports, backups | Versioning on; SSE-KMS; lifecycle to Infrequent Access after 90 days |
| Search | **Amazon OpenSearch** | Full-text index of documents (incl. OCR text), RFIs, defects, diary, people | Fed from events; rebuildable from Postgres |
| Audit archive | **S3 (Object Lock, compliance mode)** | Audit log older than 13 months, signed daily digests | Write-once evidence for SOPA disputes |
| Analytics (phase 2+) | **Postgres read replica**, then **ClickHouse or Redshift** fed by CDC | Reporting, portfolio dashboards | Never query the writer for reports |

Phase 0 needs only Postgres, Redis and S3. OpenSearch arrives with documents search in phase 1 (Postgres full-text is acceptable until then).

## 2. Schema conventions

Full list in [conventions.md](conventions.md#database). Key rules:

- One Postgres schema per module (`rfis.rfis`, `financials.payment_claims`); table names `snake_case` plural.
- Every tenant table has: `id uuid` (UUIDv7) PK, `org_id uuid not null`, `created_at`, `created_by`, `updated_at`, `updated_by`, `version int`, and `deleted_at` for soft delete where users can restore.
- Project-scoped tables also have `project_id` and indexes start `(org_id, project_id, ...)`.
- Money as `numeric(18,2)` + `currency char(3)`; never floats.
- Enumerations as `text` with check constraints (easier migrations than Postgres enums).
- Flexible per-tenant fields (custom fields, checklist answers) in `jsonb` with a JSON schema stored alongside; anything filtered often gets a real column.
- No cross-module foreign keys. Within a module, FKs are required.

## 3. Large-table strategy

Tables expected to exceed ~100M rows (`activity_log`, `change_feed`, `notifications`, `file_objects`, `photos`, `diary_*`, `ai.ai_chunks`) are **declaratively partitioned**: by time (monthly) for append-only logs, by hash of `org_id` for entity tables that grow without bound. Partition maintenance via `pg_partman`. Old log partitions detach and archive to S3.

## 4. Files pipeline

```
client ──presigned PUT──► S3 (quarantine/)
          S3 event ──► files worker: virus scan (ClamAV) → move to orgs/{orgId}/... → extract metadata
                                     → renditions: thumbnails, PDF page tiles for drawing viewer, OCR text
                                     → emits files.object.ready.v1
                       documents / photos / ai react to the event
```

- Object keys: `orgs/{orgId}/projects/{projectId}/{module}/{objectId}/{rendition}`. Never user-controlled names in keys.
- Drawing viewer uses pre-rendered tiles (deep-zoom) so large A0 sheets load fast on mobile.
- Deduplicate by content hash per org.
- Storage counted per org for entitlements.

## 5. Audit trail

- Every command produces an `activity_log` row (via event subscriber) with actor, entity, action, field-level diff, IP/device, `request_id`.
- `activity_log` is append-only: the app role has `INSERT` and `SELECT` only; no `UPDATE`/`DELETE` grants.
- Daily, each org's log entries are hashed into a chain (hash of previous digest + entries) and the digest is written to S3 Object Lock. This lets us prove a claim's history was not altered (plan §2, SOPA evidence).
- Financial documents (submitted claims, payment schedules) are additionally rendered to PDF at submission and stored immutably with their hash.

## 6. Change feed (for sync, webhooks and read models)

`shared.change_feed(org_id, seq bigint, entity_type, entity_id, project_id, op, version, at)`, with `seq` allocated per org. Mobile sync pulls by `seq`; reporting read models and search indexers can replay from it. Written in the same transaction as the change (alongside the outbox row).

## 7. Backups, retention and residency

- Aurora: continuous backup with PITR (35 days) + daily snapshots copied to a second AU region (Melbourne, ap-southeast-4) for DR.
- S3: versioning + cross-region replication to Melbourne for documents.
- All primary data stays in Australia by default. Any sub-processor (email, AI, analytics) that moves data offshore needs Sam's sign-off and must be listed for customers.
- Retention: project data kept for the life of the subscription + contractual period (construction records are often needed 7–10 years; confirm with legal). Org deletion is a soft delete with 30-day grace, then hard delete jobs (DB rows, S3 objects, search and vector entries, caches); backups age out within 35 days. Tenants in a dedicated cell can also be crypto-shredded by scheduling deletion of their own KMS key.

## 8. Encryption

TLS 1.2+ everywhere; KMS encryption at rest for Aurora, Redis, S3, OpenSearch. Pooled tenants share per-environment customer-managed KMS keys, and every encrypt/decrypt carries `org_id` as **KMS encryption context**, so ciphertext only decrypts for the same org and every decrypt is attributable in CloudTrail. Dedicated-cell (enterprise) tenants get their own KMS key. The key id is stored per org so a tenant can move to its own key later. Sam owns key policy detail ([security-licensing/03 §4](../security-licensing/03-tenant-isolation.md)); see [cross-team-decisions.md X21](cross-team-decisions.md).
