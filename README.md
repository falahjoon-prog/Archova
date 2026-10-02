# Archova

Construction management for Australian builders: projects, documents, RFIs, site diary, defects, payment claims and more, on web, iOS and Android. The design lives in [`docs/`](docs/); start with [docs/architecture/overview.md](docs/architecture/overview.md).

This repository is a pnpm + Turborepo monorepo. Backend and frontend are separate apps that share only the packages in `packages/`.

## Quick start

Requirements: Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```sh
pnpm install
docker compose up -d                 # Postgres 16, Valkey, MinIO, Mailpit
pnpm db:reset                        # create roles + database, run migrations
cp apps/api/.env.example apps/api/.env
pnpm --filter @archova/api dev       # http://localhost:4000
pnpm --filter @archova/web dev       # http://localhost:3000 (proxies /v1 to the API)
```

## Commands

| Command                                      | What it does                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Turborepo across every workspace; lint also runs the workspace boundary check                                           |
| `pnpm test:integration`                      | API integration tests against a real Postgres with RLS on (needs `TEST_DB_ADMIN_URL`, optional `TEST_REDIS_URL`)        |
| `pnpm gen`                                   | Regenerate `@archova/contracts` (types, zod schemas, operation registry) from `packages/contracts/openapi/openapi.yaml` |
| `pnpm db:compose`                            | Compose module migrations into the single ordered history in `db/migrations`                                            |
| `pnpm db:migrate` / `pnpm db:lint`           | Apply migrations as `app_migrator`; check every tenant table has forced RLS and a policy                                |
| `pnpm format`                                | Prettier                                                                                                                |

CI runs all of the above on every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)); generated contracts and composed migrations must be committed and up to date.

## Layout

```
apps/
  api/          Fastify API: auth, tenant, entitlement, permission and validation pipeline; no business logic
  web/          Next.js App Router web app
  mobile/       Expo app (iOS + Android)
  worker/ realtime/ admin/ docs-site/   not started (see each README)
modules/        backend domain modules, one Postgres schema each: identity, platform, access, files, billing
packages/       shared code: contracts, api-client, domain, query, routes, markup, sync-core, auth-client,
                ui, ui-native, design-tokens, i18n, time, ai-prompts, kernel, testing, config-*
db/migrations/  composed migration history (generated; edit the module's own db/migrations)
infra/          Terraform (DevOps)
tools/          codegen, migration runner and lints, boundary check, load tests
docs/           architecture and area design docs
```

## Rules that CI enforces

- Every tenant table has `org_id`, `ENABLE` + `FORCE` row-level security and a policy; the app connects as `app_rw`, which can't bypass RLS. Tenant context is set per transaction (`SET LOCAL`), never per session.
- The org in a request comes from the URL path and is checked against membership. Unknown or foreign orgs are a 404.
- Frontend apps never import `modules/*` or `packages/kernel`; backend code never imports client packages; pure shared packages never import React, Next.js, React Native, Node-only APIs or the database. Modules talk to each other only through their package's public `index.ts`.
- The OpenAPI contract is the source of truth. Every operation names its module (`x-module`) and, where it applies, the permission key it needs (`x-permission`).

## Phase 0 status

Built: monorepo and tooling, the contract and code generation, the kernel (tenant transactions, outbox, change feed, errors, pagination, ETags), identity (email + password, web sessions with CSRF, OAuth 2.1 + PKCE for mobile with rotating refresh tokens), orgs, companies, projects and project members, the permissions engine with the seven default templates, file upload with presigned URLs, and the integration tests that prove tenant isolation. Decisions made while building are in [ADR-0007](docs/architecture/adr/0007-self-scope-and-module-http-contract.md).
