# Backend design

**Owner:** Ben (Backend Engineer) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026
Documentation only, no code yet. Builds on Ava's [architecture overview](../architecture/overview.md) and its ADRs; where anything here disagrees with `docs/architecture/`, architecture wins and this folder gets fixed.

This folder is the implementation-level design of the backend: how modules are built inside the monorepo, every table in every module, the endpoint catalogue, background jobs, file handling, how tenant isolation is implemented, and how the database side holds up at 100,000+ users.

## Documents

| # | Document | What it covers |
|---|---|---|
| 1 | [01-module-structure.md](01-module-structure.md) | Module template, ORM and repository pattern, migrations, job wrappers, testing strategy (the items Ava's [backend-modules §7](../architecture/backend-modules.md#7-what-bens-backend-docs-should-define-next) asked for) |
| 2 | [02-multi-tenancy-auth-licensing.md](02-multi-tenancy-auth-licensing.md) | Tenant context and RLS implementation, DB roles, authentication plumbing (ADR-0004/0005), permission engine and entitlement enforcement in code |
| 3 | [schema/](schema/README.md) | Database schema for every module, conventions, partitioning |
| 4 | [04-api.md](04-api.md) | Endpoint catalogue per module, mobile sync payloads, webhooks, contract workflow |
| 5 | [05-background-jobs.md](05-background-jobs.md) | Outbox, event subscribers, queues, scheduled jobs, retries |
| 6 | [06-file-storage.md](06-file-storage.md) | Upload flow, key layout, processing pipeline, evidence storage, retention |
| 7 | [07-scaling-and-operations.md](07-scaling-and-operations.md) | Database-side scaling for 100k+ users: query rules, replicas, partitioning, cells, backend SLOs |
| 8 | [08-ai-services.md](08-ai-services.md) | Backend integration points for Ari's AI design: events, access scopes, suggestions |

## Decisions this folder relies on (settled)

| Area | Decision | Source |
|---|---|---|
| Shape | Modular monolith: `apps/api` (Fastify), `apps/worker`, `apps/realtime`; modules in `modules/*` | [ADR-0001](../architecture/adr/0001-separate-api-modular-monolith.md) |
| Contract | OpenAPI 3.1 in `packages/contracts` is the source of truth; Ben owns the spec; types, zod and `api-client` generated | [ADR-0002](../architecture/adr/0002-rest-openapi-contract-first.md), [ADR-0006](../architecture/adr/0006-shared-client-packages.md) |
| Tenancy | Shared DB, `org_id` + forced RLS, **transaction-scoped `SET LOCAL`** tenant context, no `BYPASSRLS` in api/worker; cells for scale-out and enterprise | [ADR-0003](../architecture/adr/0003-multi-tenancy-rls-and-cells.md), [Sam 03](../security-licensing/03-tenant-isolation.md) |
| Org of a request | Always from the URL path (`/v1/orgs/{orgId}/…`), verified against membership; never from tokens or bodies | X4 |
| Web auth | Opaque `__Host-sid` server session (Redis + Postgres); no JWT in the browser | [ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md) |
| Mobile/API auth | 10-minute ES256 access JWT (`sub`, `sid`, `client`; no roles, no org) + rotating refresh token | ADR-0004 |
| Identity | In-house `identity` module behind a provider-neutral interface | [ADR-0005](../architecture/adr/0005-identity-in-house-module.md) |
| Schemas | One Postgres schema per module, name = module name; kernel tables in `shared` | X8 |
| Change feed | `shared.change_feed`, per-org `seq`; sync pull returns `revokedScopes` | X7, X14 |
| AI tables | Ari's `ai_*` tables in schema `ai`, RLS, hash-partitioned by org | X9 |
| Data access | Drizzle ORM + plain SQL migrations | this folder ([01 §3](01-module-structure.md#3-data-access-drizzle-and-repositories)) |

## Asks from teammates, now done here

| From | Ask | Where |
|---|---|---|
| Mia | `shared.devices` gets `org_id`, `device_id`, `session_id`, `locale`, `timezone`, `revoked_at` | [schema/shared.md](schema/shared.md) |
| Mia | "Lost access" signal in sync pull | [04 §4](04-api.md#4-mobile-sync) (`revokedScopes`) |
| Mia, Uma | Markup visibility `private`, `company`, `project` | [schema/documents-drawings-specs.md](schema/documents-drawings-specs.md) |
| Ari | Domain events for ingestion (revision uploaded, RFI created, diary saved, photo added, meeting notes saved) | [08 §2](08-ai-services.md#2-events-the-ai-pipeline-consumes) |
| Felix | Problem `code` list and permission keys exported in `contracts` | [04 §1](04-api.md#1-contract-workflow) |

## Settled open items

| # | Question | Decision | Where applied |
|---|---|---|---|
| X21 | Encryption keys for pooled tenants | Sam's model: per-environment customer-managed KMS keys with `org_id` as encryption context; dedicated cells get their own key. Per-org `kms_key_id` column kept. Pooled deletion is a hard delete with backups ageing out within 35 days; no crypto-shredding | [schema/platform.md](schema/platform.md), [06 §7](06-file-storage.md#7-lifecycle-and-deletion) |
| X22 | S3 key prefix | `orgs/{orgId}/projects/{projectId}/…` | [06 §2](06-file-storage.md#2-key-layout) |
| X23 | Entitlements endpoint | `GET /v1/orgs/{orgId}/entitlements` | [04 §3](04-api.md#billing) |
