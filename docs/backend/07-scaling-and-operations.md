# 07. Scaling the backend to 100,000+ users

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

The capacity model, levers, SLOs and cell plan are Ava's ([scaling.md](../architecture/scaling.md)); infrastructure sizing is Owen's ([infrastructure/04](../infrastructure/04-scaling-and-load.md)). This doc covers what the backend code and schema must do so those numbers hold.

## 1. The load we design for

From Ava: ~100k users, ~10,000 orgs, ~15,000 peak concurrent, **~1,500–2,500 req/s peak (~85% reads), ~250 writes/s**, sharp 6–7 am AEST peak, ~2M uploads/month. Backend latency budgets: p95 < 200 ms reads, < 400 ms writes. Sam estimates ~5M audit events/day.

The API tier is stateless and scales horizontally, so the database is the part to protect.

## 2. Protecting the database

1. **Every list query is index-backed.** Composite indexes start `(org_id, project_id, …)` and match the list's filter + sort. CI runs `EXPLAIN` for each list query against a seeded large dataset (10k orgs, 30k projects, 100M rows in the big tables) and fails on sequential scans of large tables.
2. **Cursor pagination only** (keyset on the sort columns + `id`), max 200 rows. No `OFFSET`, no `COUNT(*)` on large lists: totals come from cached counters or are shown as "200+".
3. **Read replicas** via the kernel router: queries marked `readOnly` go to replicas; a request that just wrote sets a short read-your-writes flag (Redis, keyed by session, a few seconds) so its follow-up reads hit the writer. Sync pulls, registers, search and reports always read from replicas.
4. **Connection discipline:** transaction-mode pooling (RDS Proxy / PgBouncer); one short transaction per use case; no network calls (S3, email, AI) inside a transaction; `statement_timeout` 5 s for API, 60 s for jobs, longer only on the reporting replica.
5. **Hot rows avoided:** per-org `shared.org_sequences` and per-project `shared.counters` lock only within one tenant; audit hash chain uses a per-org advisory lock in the batch writer, not in user requests.
6. **Partitioning** per [schema/README](schema/README.md#large-tables-and-partitioning): time partitions for logs (detached to S3 Parquet), hash-by-org partitions for unbounded entity tables.
7. **Denormalise across modules instead of joining:** read models fed from events keep list screens to single-schema queries.
8. **Caching:** permissions and entitlements in Redis (versioned keys); reference data (SOPA rules, holidays, plans) in-process; `ETag`/`304` on detail reads; counts (unread notifications, ball-in-court) in Redis.
9. **Bulk work is chunked:** imports, exports and backfills process in batches of ~1,000 rows with commits in between and run on the `maintenance` or module queues, never in a request.
10. **Reports never touch the writer:** portfolio dashboards and the report builder read from replicas, then from the CDC-fed analytics store.

## 3. Write path at peak

At ~250 writes/s, each write is one transaction touching the entity row, a `shared.change_feed` row, one or two `shared.outbox` rows and occasionally a counter. Audit rows are written asynchronously in batches. That is roughly 1,000 small inserts/updates per second on the writer, comfortably inside a `db.r7g.4xlarge`-class Aurora writer with headroom for 10× via cells.

## 4. Cells

Built cell-aware from day one, per [multi-tenancy §4](../architecture/multi-tenancy.md#4-cells-scale-out-and-enterprise-isolation): every tenant row has `org_id`, no cross-org foreign keys, every object key and cache key is org-prefixed, `identity` and the tenant directory are global. Moving an org between cells is an export/import by `org_id` (Postgres rows per module schema + S3 prefix copy + search/vector reindex from the change feed) with a short read-only window. A second cell is added when the writer nears 60% sustained CPU at peak, or for an enterprise or other-region customer.

## 5. Backend-owned reliability items

| Item | Target / rule |
|---|---|
| Outbox lag | < 1 s p95; alert at 30 s |
| Change feed to device | a change visible to a pulling device within 2 s of commit |
| Queue age | `events`, `default`, `email` < 10 s; others < 2 min; alert beyond |
| SOPA job | never skipped; paged on failure |
| Migrations | expand/contract; old and new code run side by side during rolling deploys |
| Outbound calls | timeouts, retries with jitter, circuit breakers (email, AI, billing provider, Xero/MYOB) |

## 6. Observability hooks in code

- OpenTelemetry spans for each plugin, use case, repository call and job; trace id carried in the event envelope so a request can be followed into the jobs it caused.
- Structured logs with `requestId`, `orgId`, `userId`, `route`; never tokens, file contents, claim amounts or full payloads.
- Per-org request, error and queue metrics to find noisy tenants.
- Owen picks the backend for these in [infrastructure/05-observability.md](../infrastructure/05-observability.md).

## 7. Load testing

k6 scripts in `tools/load` replay Ava's peak profile (including sync pull/push bursts at 6 am and drawing-set uploads) against staging seeded at 100k-user scale. Any endpoint over budget blocks the phase release.
