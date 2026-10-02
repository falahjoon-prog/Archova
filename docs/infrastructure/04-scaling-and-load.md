# 04 · Scaling and load targets

**Owner:** Owen · **Status:** Draft v1 · 2 Oct 2026
**Builds on:** Ava's [scaling.md](../architecture/scaling.md) (capacity model, cells) and Ben's [07-scaling-and-operations.md](../backend/07-scaling-and-operations.md). If numbers here differ from Ava's, hers win and this doc is updated.

## 1. Load model at the 100k-user target

These are design assumptions, to be replaced with measured numbers from pilots.

| Input | Value | Reasoning |
|---|---|---|
| Registered users | 100,000 | john's target |
| Tenant organisations | ~10,000 | Ava; includes many small subcontractor orgs |
| Largest single tenant | ~5,000 users | A tier-1 builder with its subcontractor network |
| Daily active users | ~40,000 (40%) | Site teams use it daily, subbies and clients less |
| Peak concurrent users | ~15,000 | Ava; weekday 6:30–9:00am AEST (site start) and 2–4pm |
| API requests per active user | ~1 every 5 s while active | Real-time push replaces polling |
| **Peak API rate** | **~3,000 req/s sustained, design for 6,000 req/s bursts** | 15,000 ÷ 5, ×2 headroom |
| Read : write ratio | ~90 : 10 | Typical for document and workflow apps |
| WebSocket connections | ~20,000 peak | Concurrent web users plus foregrounded mobile apps |
| Photo uploads | ~200,000/day, ~1.5 MB each after on-device compression | 20,000 field users × 10 photos |
| New file storage | **~15–25 TB/month** at full scale | Photos ~9 TB, drawings, documents, exports, versions |
| Total file storage after 3 years | **~0.5 PB** | Most of it cold, hence Intelligent-Tiering |
| Audit / activity rows | ~5M/day (~1.8B/year) | Every write is logged (Ava D8) |
| Hot database size (year 3) | ~2–4 TB | Excluding archived audit partitions |

### Known peaks
- **Morning site start (6:30–9:00am AEST):** mobile apps sync the previous day's offline photos and diaries; upload and thumbnail queues spike.
- **Month end (last 3 business days and first 2):** progress claims, PDF generation and approvals. SOPA deadlines make this the period where downtime costs customers the most, hence the deploy freeze in [03](03-ci-cd.md#4-main-branch-pipeline-deploy).
- **Tender deadlines (phase 4):** large document downloads by many subcontractors at once; served from CloudFront.
- **Time zones:** Perth is 2–3 hours behind the east coast, which spreads the morning peak a little.

## 2. Service level objectives

| SLO | Target | Measured by |
|---|---|---|
| API availability | 99.9% monthly (≈ 43 min error budget) | Successful (non-5xx) requests ÷ all requests at the ALB, excluding client errors |
| Web app availability | 99.9% monthly | Synthetic checks from 3 AU locations every minute + ALB success rate |
| API latency, reads | p95 < 300 ms, p99 < 1 s | ALB target response time and OTel spans, per route |
| API latency, writes | p95 < 500 ms, p99 < 1.5 s | Same |
| Search | p95 < 500 ms | Search route spans |
| Upload start (presign) | p95 < 200 ms | Route spans |
| Thumbnail ready after upload | p95 < 30 s | Job timing |
| Real-time notification delivery | p95 < 5 s from event | Outbox timestamp → client ack sample |
| Email sent | p95 < 60 s from event | Job timing |
| PDF export (typical claim or RFI) | p95 < 30 s | Job timing |
| **SOPA reminders and due-date jobs** | **100% run on schedule; zero missed** | Dead-man's-switch alarm on each scheduled run |
| AI first token (assistant) | p95 < 2.5 s | ai module spans (Ari owns the target) |

Error-budget policy: if a service burns more than 50% of its monthly budget, feature deploys to it pause and reliability work takes priority until the burn rate recovers.

## 3. Capacity plan by stage

Sizes are starting points; autoscaling handles the day-to-day, and these are the ceilings and floors we expect.

| Component | Pilot (< 1k users) | Growth (~10k users) | Target (~100k users) |
|---|---|---|---|
| `api` tasks (1 vCPU, 2 GB) | 3 (min) | 4–10 | 10–40 (max 60) |
| `web` tasks (1 vCPU, 2 GB) | 2–3 | 3–6 | 6–20 (max 30) |
| `realtime` tasks (0.5 vCPU, 1 GB, ~5k connections each) | 2 | 2–3 | 4–8 |
| `worker` tasks (all queue groups) | 2–4 | 4–12 | 10–50 |
| `ai-worker` tasks | 1–2 | 2–6 | 4–30 (capped by AI budget) |
| Aurora writer | `db.r7g.large` | `db.r7g.xlarge` | `db.r7g.2xlarge`, headroom to `4xlarge` |
| Aurora readers | 1 × `large` | 1–2 × `xlarge` | 2–4 × `2xlarge` (auto scaling) |
| RDS Proxy | yes | yes | yes |
| Valkey (queue + cache) | `t4g.medium` ×2 clusters | `r7g.large` ×2 clusters | `r7g.xlarge` ×2 clusters, cache sharded if needed |
| OpenSearch | off (Postgres full-text) | 3 × `r7g.large.search` | 3–6 × `r7g.xlarge.search` + 3 masters |
| CloudFront | yes | yes | yes |

**Throughput assumption behind the API numbers:** a 1 vCPU Node/Fastify task serves roughly 150–250 typical requests/s at our latency targets. 3,000 req/s ÷ ~150 ≈ 20 tasks at peak, with headroom to 60. Validate in the first load test and adjust.

**Database connections:** each `api` task keeps a pool of ~10; 60 tasks would mean 600 client connections, which RDS Proxy multiplexes onto ~150–250 database connections. Tenant context uses `SET LOCAL` inside each transaction so connections are not pinned.

## 4. Autoscaling rules

| Service | Scale out on | Scale in | Other |
|---|---|---|---|
| `api`, `web` | Target tracking: CPU 55% **and** ALB requests per target (set from load test, ~120 req/s) | Slow: 5 min cooldown, max 10% of tasks at a time | Scheduled floor raised at 6:00am AEST weekdays and during month end, so the morning ramp never waits for scaling |
| `realtime` | Active connections per task > 4,000 | Connection-draining over 10 min (clients reconnect with jitter) | |
| `worker` groups | Queue backlog per task (BullMQ waiting jobs ÷ running tasks) via a custom CloudWatch metric | When backlog is zero for 15 min | Each queue group has its own min/max so PDF bursts cannot starve notifications |
| `ai-worker` | Queue backlog | Same | Hard max tasks + per-tenant concurrency limit; ops flag to pause non-interactive AI jobs |
| Aurora readers | Aurora auto scaling: average reader CPU > 60% | CPU < 30% for 30 min | Writer is resized manually in a planned window (Aurora failover ≈ 30 s) |
| OpenSearch | Manual, from capacity alarms (JVM pressure, storage 70%) | Manual | |

## 5. Protecting the platform from load

- **Rate limits** at three layers: WAF per IP (blocks floods), API per access token and per org (token bucket in Valkey, limits by plan from the billing module), and per endpoint for expensive operations (exports, bulk downloads, AI).
- **Noisy-neighbour controls:** per-tenant concurrency limits on heavy job types (PDF, drawing processing, AI), so one large builder uploading a 2,000-sheet drawing set cannot delay everyone else's thumbnails.
- **Load shedding:** ops feature flags can switch off non-essential work under stress (AI suggestions, search re-indexing, analytics), keeping core workflows (RFIs, diary, defects, claims) up.
- **Large files never touch app servers:** presigned S3 uploads and CloudFront signed downloads; multipart uploads for files over 100 MB.
- **Caching:** CloudFront for static assets and immutable file renditions (thumbnails, drawing tiles); Valkey for sessions, permission sets and entitlements; HTTP `ETag`s on list endpoints so mobile sync sends little data.
- **Back-pressure:** queues absorb bursts; the API returns `429` with `Retry-After` rather than timing out.

## 6. Data growth

- **Activity/audit log** partitioned monthly (Ben). Partitions older than 13 months are exported to Parquet in the `audit-archive` S3 bucket (Object Lock, retained ≥ 7 years, queryable with Athena) and detached from the hot database. The legal retention period is Sam's call.
- **Files:** S3 Intelligent-Tiering moves untouched files to cheaper tiers automatically; superseded drawing revisions and closed-project files go to Glacier Instant Retrieval after 12 months, still downloadable in milliseconds.
- **Search indexes:** rolled over by time where it makes sense; closed projects can be moved to a cold index.

## 7. Load-testing plan

Tool: **k6**, scripts kept in the monorepo (`tools/load/`), run from Fargate tasks in the `loadtest` account (and from outside AWS once, to include CloudFront and WAF). The environment is built from the same Terraform as production and seeded to the 100k-user volume.

| Scenario | Shape | Pass criteria |
|---|---|---|
| Peak steady state | 3,000 req/s, realistic route mix, 1 hour | All SLOs in §2 met; DB writer CPU < 60% |
| Spike | 0 → 6,000 req/s in 5 min | No 5xx above 0.1%; autoscaling catches up within 5 min; p99 < 2 s during ramp |
| Morning sync | 20,000 simulated mobile devices syncing offline changes and photos over 30 min | Sync completes; thumbnail p95 < 60 s during the burst |
| Month end | Claims and PDF generation at 10× normal | PDF p95 < 60 s; other queues unaffected |
| Soak | 60% of peak for 8 hours | No memory growth, no connection leaks, stable latency |
| Real-time | 20,000 WebSocket connections, reconnect storm after a deploy | All reconnect within 2 min, no API impact |
| Noisy tenant | One 5,000-user tenant at 5× its normal load | Other tenants' SLOs still met |
| Failure under load | Kill an AZ's tasks, fail over Aurora, flush cache, during peak scenario | Recovery within RTO targets in [06](06-backup-and-dr.md); error rate back to normal < 5 min |

**When:** first full run at the end of phase 0 (baseline), then before each phase launch and before crossing each stage in §3. A 5-minute regression smoke runs on every staging deploy ([03](03-ci-cd.md)).

## 8. Scaling beyond one cell

A **cell** is a complete copy of the stack (Ava D5, D12). Cell 1 is sized to carry the 100k-user target. Triggers to open another cell:

1. The Aurora writer at peak exceeds ~60% CPU on `db.r7g.4xlarge` after query tuning, or the hot database passes ~10 TB.
2. An enterprise or government customer requires dedicated infrastructure (priced accordingly by Sam).
3. A new country with its own residency requirement (e.g. NZ, UK), which means a cell in that region.
4. Blast radius: at roughly 50,000 active users per cell, a cell outage affects too many customers at once.

Infra provides: a new account, `envs/prod-cellN` from the same cell module, a tenant-directory lookup (small, global-to-AU routing table) so the edge routes each org to its cell, and a tenant move procedure (logical replication of one tenant's rows plus S3 prefix copy, cut over during a quiet window). The routing and tenant-move design is Ava's; this doc covers provisioning and operations.
