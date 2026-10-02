# 01. Module structure and backend engineering patterns

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

The repo layout, module catalogue and layer rules are fixed by Ava in [repo-structure.md](../architecture/repo-structure.md) and [backend-modules.md](../architecture/backend-modules.md). This doc doesn't repeat them; it defines what she asked the backend to define: the module template, data access, migrations, job wrappers and testing.

## 1. Backend parts of the monorepo (summary)

```
apps/api        Fastify HTTP server: loads modules, plugins (auth, tenant, entitlement, validation). No business logic.
apps/worker     BullMQ processors + outbox relay + schedulers. Loads the same modules. No business logic.
apps/realtime   WebSocket gateway (ADR-0004 §6). Pushes "changed" hints; never writes business data.
modules/<name>  One package per domain (@archova/mod-<name>), the only place business logic lives.
packages/kernel tenant context, db client + router, repository base, outbox, change feed, errors, logger, config
packages/contracts  OpenAPI spec (source of truth), generated types + zod, event schemas, problem codes, permission keys
packages/domain     pure shared rules: ids/prefixes, money, state machines, SOPA business-day rules
db/             migrations (one ordered history), seeds, RLS helpers
```

Module list (schema name = module name): `identity`, `platform`, `access`, `files`, `collaboration`, `audit`, `notifications`, `search`, `billing`, `documents`, `rfis`, `submittals`, `diary`, `defects`, `meetings`, `photos`, `correspondence`, `quality`, `safety`, `integrations`, `financials`, `ai`, `reporting`, then `scheduling`, `precon`, `workforce` and later phase modules.

## 2. The module template

`pnpm gen:module <name>` scaffolds Ava's skeleton ([repo-structure §2](../architecture/repo-structure.md#2-inside-a-backend-module)) with these files filled in:

```
modules/<name>/
├── src/
│   ├── index.ts              # public interface: exported queries/commands + event types. Nothing else.
│   ├── module.ts             # defineModule({ name, routes, jobs, subscribers, permissions, entityTypes, entitlement })
│   ├── api/routes.ts         # handlers bound to OpenAPI operationIds; parse → authorise → call use case → map
│   ├── api/mappers.ts        # row → DTO (camelCase, prefixed ids, money objects)
│   ├── application/commands/ # one use case per file, e.g. close-rfi.ts
│   ├── application/queries/  # one per file, e.g. list-rfis.ts
│   ├── domain/               # entities, state machines, rules, events.ts (pure, no IO)
│   ├── infra/tables.ts       # Drizzle definitions for Postgres schema <name>
│   ├── infra/<entity>.repository.ts
│   ├── jobs/                 # processors registered by module.ts
│   ├── subscribers/          # handlers for other modules' events
│   └── permissions.ts        # tool name, levels → keys, company-scoping column, entity types + resolvers
├── db/migrations/            # this module's SQL; composed into /db by the migration tool
├── test/unit, test/integration
└── package.json
```

`defineModule` is the single registration point. `apps/api` and `apps/worker` import a list of modules and nothing else, so adding a module never touches app code beyond that list.

## 3. Data access: Drizzle and repositories

**ORM: Drizzle** (Ava's recommendation, confirmed). Reasons: SQL stays visible, works naturally inside one transaction with `SET LOCAL`, supports Postgres schemas, `ltree`/`vector` via custom types, and no separate query engine process.

Rules:
1. **Repositories are the only code that runs SQL.** They receive a transaction handle from the kernel; they cannot open their own connection.
2. **Every use case runs in exactly one transaction** opened by the kernel's `withTenantTx(ctx, fn)`, which does `BEGIN; SET LOCAL app.org_id = $1; SET LOCAL app.user_id = $2; SET LOCAL statement_timeout = '5s'` and commits or rolls back. Session-level `SET` is banned (lint rule).
3. **Read routing:** queries mark themselves `readOnly`; the kernel routes them to a replica unless the request just wrote (read-your-writes flag, see [07 §2](07-scaling-and-operations.md#2-protecting-the-database)).
4. **Writes go through `BaseRepository.save()`** which: checks `version` (optimistic concurrency, throws `VersionConflict`), bumps `version`, sets `updated_*`, and appends the `shared.change_feed` row for sync-relevant entities. Outbox events are appended by the use case with `ctx.events.add(...)` and flushed in the same transaction.
5. **List queries** take a permission filter from `access.listFilter(ctx, tool, projectId)` and compose it into the `WHERE` clause; never fetch-then-filter.
6. **No cross-module SQL.** Need another module's data → call its `index.ts` query (batched by id) or keep a denormalised copy updated from its events (e.g. `rfis` stores `drawing_sheet_number` copied from `documents.drawing.revision.published.v1`).
7. **N+1 guard:** module query functions accept arrays of ids; a DataLoader-style batcher per request collapses calls.

## 4. Migrations

- Tool: **plain SQL files** managed by `node-pg-migrate` (or Drizzle Kit generating SQL that is then reviewed and committed). SQL is the reviewed artifact, not ORM diffs.
- Each module keeps its migrations in `modules/<name>/db/migrations/`; `pnpm db:compose` merges them into the single ordered history in `/db/migrations` by timestamp, as Ava specified.
- Every module's first migration: `CREATE SCHEMA <name>`, grants to `app_rw`, and for each table the helper `select kernel.enable_tenant_rls('<schema>.<table>')` which enables + forces RLS and creates the standard policy and `updated_at` trigger.
- CI checks: table with `org_id` and no policy → fail; table without `org_id` not on the global allow-list → fail; `CREATE INDEX` without `CONCURRENTLY` on an existing table → fail; `ALTER TABLE … ADD COLUMN … NOT NULL` without default on a large table → fail.
- Expand/contract only. Deploy order: migrate (expand) → deploy code → backfill job → contract migration in a later release.
- Migrations run as `app_migrator` from CI/CD, never from the app.

## 5. Use-case shape (what every command looks like)

```
closeRfi(ctx, { rfiId, expectedVersion, note })
  1. access.assert(ctx, 'rfis.close', { projectId })         -> 403 if not allowed
  2. rfi = repo.get(rfiId)                                    -> 404 if missing / other tenant
  3. rfi.close(note)                                          -> domain state machine, throws rfi.already_closed
  4. repo.save(rfi, expectedVersion)                          -> 412 on version mismatch; change_feed row
  5. ctx.events.add('rfis.rfi.closed.v1', {...ids, closedAt}) -> outbox row, same transaction
  6. return rfi                                               -> mapper -> DTO
```

Audit, notifications, search, AI and webhooks all react to the event; the command doesn't call them.

## 6. Job framework wrapper

`defineJob({ queue, name, schema, handler, retries, timeout, tenant: 'org' | 'platform' })` from `packages/kernel`:
- validates the payload with zod; tenant jobs require `orgId` and run the handler inside `withTenantTx`;
- `tenant: 'platform'` jobs connect as `app_platform` (Sam 03 §3), may only read the views they're granted, and must fan out per-org jobs for any tenant work;
- deterministic `jobId` from the payload for dedupe; standard retry/backoff; OpenTelemetry span linked to the triggering request's trace;
- progress reporting into `shared.job_runs` via `ctx.progress(done, total)`.

Event subscribers are jobs too: `defineSubscriber('rfis.rfi.closed.v1', handler)`; the dispatcher gives each subscriber its own job, deduped by `(event_id, subscriber)`.

## 7. Testing strategy

| Layer | What | How |
|---|---|---|
| Domain unit | state machines, rules (SOPA dates, retention maths, numbering formats) | pure tests, table-driven; SOPA has a legal test-case table per state |
| Use-case integration | each command/query against real Postgres 16 with RLS **on**, as `app_rw` | Testcontainers; transaction rolled back per test; factories from `packages/testing` |
| Tenant isolation | every repository function and every route, seeded org A + org B | runs in CI on every PR (Sam 03 §7): wrong-org → zero rows / 404 |
| Permission matrix | each seeded template × each route | generated from `permissions.ts` declarations |
| Contract | responses validated against OpenAPI; `oasdiff` breaking-change check | in CI |
| Migrations | apply all on empty DB + on a snapshot of staging schema; RLS lint | in CI |
| Sync | push/pull scenarios incl. conflicts and `revokedScopes` | shared with Mia's contract tests |
| Load | k6 profile from [architecture/scaling §1](../architecture/scaling.md#1-capacity-model-for-100000-users) | before each phase exit |

Critical modules (`access`, `billing`, `financials`, `identity`, `audit`) require a test for every rule, as conventions require.
