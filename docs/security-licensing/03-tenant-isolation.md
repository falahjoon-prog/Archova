# 03. Tenant isolation

Owner: Sam. Status: **signed off by architecture** (Ava, cross-team decision X11, 2 Oct 2026). Infrastructure lead to confirm S3/KMS details.
Related: [02 roles and permissions](02-roles-permissions.md), [09 security baseline](09-security-baseline.md).

## 1. Principle

One builder's data must never be visible to another builder through any path: API, search, file links, exports, cache, logs, AI answers, analytics, or a bug in a single query. We assume application code *will* have a bug at some point, so isolation has **three independent layers** and a leak needs all three to fail.

1. Application permission check (`can()`, doc 02).
2. Database row-level security (RLS) in PostgreSQL.
3. Per-tenant scoping of every other store (files, cache, search, queues, AI index), plus automated cross-tenant tests.

## 2. Tenancy model

**Default: pooled.** All tenants share one Postgres cluster and one schema, every tenant-owned row carries `org_id`. This is the only practical model for thousands of small/mid orgs and 100k+ users.

**Enterprise option: siloed.** A large builder or government-linked customer can buy a dedicated **cell** (Ava's `multi-tenancy.md` §4: own Aurora cluster, Redis, OpenSearch) plus a dedicated KMS key. Routing by the global tenant directory. Designed for now, built when the first customer pays for it.

Cross-org collaboration doesn't break this: a **project belongs to exactly one org** (the builder that created it). External collaborators reach it through `ProjectMember`; their own org's data is separate. The tenant of a request is the tenant of the resource being accessed, not of the user.

## 3. Database layer (PostgreSQL)

- Every tenant table: `org_id uuid NOT NULL`, part of the leading index columns (`(org_id, project_id, ...)`).
- RLS enabled and **forced** (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`) on every tenant table:
  ```sql
  CREATE POLICY tenant_isolation ON rfi
    USING (org_id = current_setting('app.org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.org_id')::uuid);
  ```
- Request flow: authenticate → resolve target project → verify membership → open transaction → `SET LOCAL app.org_id = '<owning org>'` → queries. `SET LOCAL` dies with the transaction, so a pooled connection can't carry one tenant's context into the next request.
- If `app.org_id` is unset, `current_setting` errors and the query fails closed.
- Database roles:
  - `app_rw`: used by the API, no `BYPASSRLS`, not table owner.
  - `app_migrator`: owns tables, used only by migrations in CI/CD.
  - `app_platform`: for cross-tenant platform jobs (billing usage rollups, ACV calculation, "claims due tomorrow" scans). **No `BYPASSRLS`.** It can only read a few `SECURITY DEFINER` views/functions exposing the minimum columns (ids, dates, amounts) and then fans out into per-org jobs under `app_rw`. Every use logged. (Confirmed in Ava's sign-off X11: no `BYPASSRLS` for api or worker.)
    - Deliberate exception: the outbox relay has column-limited `SELECT (id, org_id, type, occurred_at, published_at)` and `UPDATE (published_at)` on `shared.outbox` only (migration 20261028150000, approved on PR #73).
- Global tables (no `org_id`): `User`, `Credential`, plan catalogue, public holidays/SOPA rules. Accessed by explicit, reviewed code paths.
- Lint rule in CI: every new table in a migration must either have `org_id` + RLS policy, or be on an allow-list of global tables with a reviewer sign-off.
- Connection pooling (PgBouncer transaction mode) is compatible with `SET LOCAL`. Session-level `SET` is banned.

## 4. Files (S3)

- Bucket per environment, keys `orgs/{orgId}/projects/{projectId}/{uuid}` (Ava's convention). Never user-controlled file names in keys.
- No public objects. Block Public Access on.
- Downloads: API checks `can()` then issues a presigned GET URL valid for 5 minutes, with `response-content-disposition` set. Uploads: presigned PUT/POST scoped to one key, size and content-type limits.
- Server-side encryption with KMS. Siloed (dedicated cell) tenants get their own KMS key. Pooled tenants share per-environment keys, but every encrypt/decrypt call carries `org_id` as **KMS encryption context**, so a ciphertext can only be decrypted by a request for the same org and every decrypt is attributable in CloudTrail. This satisfies Ari's request for per-org protection of stored AI prompts (`docs/ai/04` §2) without thousands of keys.
- Uploaded files are virus-scanned in a worker before being marked available. Thumbnails/PDF renders are written back under the same org prefix.
- CDN (CloudFront) uses signed URLs/cookies, not open caching.

## 5. Cache, queues, search, analytics

| Store | Rule |
|---|---|
| Redis cache | Every key prefixed `org:{orgId}:` (Ava's convention). Shared helper only; raw Redis client not exported to feature code. |
| Job queue (BullMQ) | Job payload carries `org_id`; the worker sets DB tenant context from it before doing anything. A job without `org_id` must be explicitly marked platform-level. |
| Search (OpenSearch/Postgres FTS) | Every document indexed with `org_id`, `project_id`, `company_id`, `is_private`, ACL list. Queries always add the tenant + permission filter server-side. Large tenants can get their own index later. |
| AI vector index | Same as search: embeddings stored with `org_id`, `project_id` and ACL metadata; retrieval filtered before ranking, never after. No shared embeddings across tenants. |
| Analytics / data warehouse | Tenant identifiers kept, personal data minimised; product analytics uses pseudonymous IDs. Internal access only. |
| Logs | Contain `org_id` and `request_id`, never file contents, claim amounts, or tokens. |

## 6. Noisy-neighbour protection

- Per-org rate limits on API (token bucket in Redis), per-org job concurrency caps, per-org storage tracking.
- Large imports and exports run on separate queues so one builder's 50 GB drawing import doesn't stall others' notifications.
- Query timeouts (statement_timeout) on the app role.

## 7. Testing and verification

- **Cross-tenant test suite** in CI: seeds two orgs, then for every API route asserts that a user of org A gets 404 (not 403, to avoid confirming existence) for org B's resources by ID, by list, by search, by export.
- RLS unit tests: run each repository function with the wrong `app.org_id` and assert zero rows.
- Use non-sequential IDs (UUIDv7) everywhere public; never expose sequential DB IDs. Human numbers (RFI #42) are per-project and not used for lookup without project context.
- Annual external penetration test with tenant-isolation focus; findings tracked to closure.

## 8. Tenant offboarding

On cancellation (doc 06 for timing): full export offered, then deletion of DB rows, S3 objects, search/vector entries, caches, and backups aged out per backup retention (35 days). Audit records required for legal retention are kept separately (doc 07), and the customer is told what's kept and why.
