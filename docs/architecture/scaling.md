# Scaling, performance and reliability

**Owner:** Ava (model and levers), Owen (infrastructure detail in `docs/infrastructure/`) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Capacity model for 100,000 users

Assumptions (revisit with real pilot data):

| Input | Value |
|---|---|
| Registered users | 100,000 (≈ 60% field/mobile, 40% office/web) |
| Orgs (tenants) | ~10,000 (long tail of small subbie orgs, ~1,500 paying builders) |
| Daily active | 40% → 40,000 |
| Peak concurrent | 15% → 15,000 (AU working hours 6am–6pm AEST, morning site-start peak) |
| Requests per active user | ~1 req / 10 s while active (incl. polling, sync) |
| **Peak API load** | **~1,500–2,500 req/s**, ~85% reads |
| Writes | ~250 writes/s peak |
| Files | ~2M uploads/month (photos dominate), ~50 TB stored by year 3 |
| WebSocket connections | ~15,000 concurrent |

This is a moderate load. A well-indexed single Aurora cluster (e.g. `db.r7g.4xlarge` writer + replicas) and ~20–40 API tasks handle it. The architecture targets 10× headroom through the levers below and cells beyond that.

## 2. Scaling levers (in order of use)

1. **Stateless horizontal scaling**: `api`, `realtime`, `worker` on ECS Fargate with target-tracking autoscaling (CPU and request count; workers on queue depth). No sticky sessions.
2. **Read replicas**: queries tagged `readOnly` go to replicas through the kernel's DB router (with read-your-writes: requests that just wrote stick to the writer for a few seconds via a session flag).
3. **Caching**: entitlements, permissions, project directory and reference data in Redis; HTTP `ETag`/`304` for clients; CloudFront for static assets and file renditions.
4. **Async by default**: anything not needed in the response (notifications, indexing, PDFs, AI, webhooks, emails) runs in workers.
5. **Partitioning** of large tables ([data-architecture.md §3](data-architecture.md#3-large-table-strategy)).
6. **Search offload**: list screens with free-text or complex filters hit OpenSearch, not Postgres.
7. **Cells**: add a cell when one writer nears capacity ([multi-tenancy.md §4](multi-tenancy.md#4-cells-scale-out-and-enterprise-isolation)). Linear scale to 1M+ users.
8. **Service extraction** for hot modules (files, ai, search) as already-separate processes.

## 3. Performance budgets and SLOs

| Measure | Target |
|---|---|
| API p95 latency (reads) | < 200 ms |
| API p95 latency (writes) | < 400 ms |
| Web LCP (project dashboards, lists) | < 2.5 s on 4G |
| Mobile cold start to usable (cached data) | < 2 s |
| Drawing open (A1 sheet, first tiles) | < 1.5 s |
| Notification delivery (in-app) | < 5 s |
| Availability (API, monthly) | 99.9% (phase 1–3), 99.95% (phase 4+) |
| RPO / RTO | 5 min / 1 h (cross-region restore in Melbourne) |

Any endpoint over budget in load tests blocks release. k6 load tests in `tools/load` simulate the profile in §1 against staging before each phase launch.

## 4. Noisy-neighbour protection

- Per-org and per-token rate limits; separate, lower limits for public API and bulk operations.
- Per-org fair queuing in workers (BullMQ group concurrency keyed by `org_id`) so one tenant's 10,000-page drawing import doesn't starve others.
- Statement timeouts (e.g. 5 s for API queries, longer for reporting replica).
- Heavy exports and reports run on the replica or analytics store only.
- Large enterprise tenants can be moved to their own cell.

## 5. Reliability patterns

- Multi-AZ for every data store and ≥2 AZ spread for every service.
- Health checks, graceful shutdown (drain in-flight requests and jobs).
- Timeouts, retries with jitter, and circuit breakers on every outbound call (email, AI provider, Xero/MYOB).
- Idempotency keys on writes and idempotent consumers on events: retries never double-create an RFI or claim.
- Feature flags (per org) for progressive rollout; dark launches for new modules.
- Blue/green or rolling deploys; DB migrations are expand-then-contract so old and new code run side by side.

## 6. Observability

- OpenTelemetry traces, metrics and logs from every app (trace id flows from client → api → events → workers).
- Structured JSON logs with `org_id`, `user_id`, `request_id`; no PII in log messages beyond IDs.
- Per-org usage and error dashboards (helps support and shows noisy tenants).
- Owen picks the backend (Datadog / Grafana Cloud / CloudWatch) in `docs/infrastructure/`.

## 7. Cost at 100,000 users (agreed planning figure)

| Line | Planning figure / month (USD) | Source |
|---|---|---|
| Infrastructure | ~$42–45k with commitments (~$55k list) | Owen, [infrastructure/07](../infrastructure/07-cost-estimates.md) |
| AI (models, OCR, embeddings) | **~$151k base case**; target ≤ $100k after Ari's cost levers; range $57k (light) to $294k (heavy) | Ari, [ai/05](../ai/05-cost-control.md) |
| **Total** | **~$195k** budget, ~$145k if the AI target is met | |

AI is the largest cost line, so it must be metered per org and sold through plan credit allowances and top-ups (D11, Sam). See [cross-team-decisions.md X16](cross-team-decisions.md).

## 8. Environments

`local` (docker compose: Postgres, Redis, MinIO, OpenSearch) → `preview` (per pull request, ephemeral, web + api) → `staging` (prod-like, seeded, load tests) → `production` (AU cell 1). Mobile builds via EAS with matching channels.
