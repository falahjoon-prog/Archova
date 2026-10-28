# Repository and code structure

**Owner:** Ava · **Status:** Draft v1 · Back to [overview](overview.md)

One monorepo, `archova`, managed with **pnpm workspaces** and **Turborepo** (task graph + remote cache). Backend and frontend are strictly separated into different apps; they share only the packages in `packages/`.

## 1. Top-level layout

```
archova/
├── apps/
│   ├── api/                 # Backend: modular monolith HTTP API (Fastify)
│   ├── worker/              # Backend: background job processors (BullMQ), same modules as api
│   ├── realtime/            # Backend: WebSocket gateway (notifications, presence)
│   ├── web/                 # Frontend: Next.js App Router web app
│   ├── mobile/              # Frontend: Expo / React Native app (iOS + Android)
│   ├── admin/               # Frontend: internal back-office (support, tenant ops), Next.js
│   └── docs-site/           # Public API docs + developer portal (generated from OpenAPI)
│
├── modules/                 # Backend domain modules (consumed by api + worker only)
│   ├── identity/            # global: sessions, credentials, MFA, passkeys, SSO/SCIM, OAuth server (ADR-0005)
│   ├── platform/            # orgs, users, memberships, companies, projects, directory
│   ├── access/              # permissions engine, roles, permission templates
│   ├── documents/           # folders, documents, revisions, drawings, specs, transmittals
│   ├── rfis/
│   ├── submittals/
│   ├── diary/               # site diary / daily log
│   ├── defects/             # punch list
│   ├── meetings/
│   ├── photos/
│   ├── correspondence/
│   ├── quality/             # inspections, observations (phase 2)
│   ├── safety/              # incidents, WHS (phase 2)
│   ├── financials/          # budget, contracts, variations, claims, SOPA (phase 3)
│   ├── scheduling/          # phase 4
│   ├── estimating/          # cost library, estimates, takeoff, tender packages, quotes (phase 1–2, X30)
│   ├── precon/              # bid board, prequalification, bid levelling (phase 4)
│   ├── collaboration/       # comments, attachments, mentions (shared by all entities)
│   ├── notifications/       # in-app, email, push; preferences
│   ├── audit/               # append-only activity log
│   ├── search/              # indexing + query
│   ├── files/               # upload, storage, thumbnails, PDF render
│   ├── ai/                  # AI gateway, RAG, agents (see ai-integration.md)
│   ├── billing/             # plans, entitlements, licences, usage metering
│   ├── integrations/        # Xero, MYOB, M365, webhooks, public API apps
│   └── reporting/           # exports, dashboards, report builder
│
├── packages/                # Shared code (no domain logic that belongs to one module)
│   ├── contracts/           # OpenAPI spec (source of truth) + generated TS types & zod schemas
│   ├── api-client/          # Generated typed HTTP client used by web + mobile
│   ├── domain/              # Pure TS rules shared by clients AND backend: ids, money, enums, state machines,
│   │                        #   validators, SOPA business-day rules, client-side permissions (ADR-0006)
│   ├── query/               # TanStack query keys + queryOptions per resource (web, mobile online reads)
│   ├── routes/              # Typed route + deep-link builders (web, mobile, email/push templates)
│   ├── markup/              # Drawing markup schema, geometry, hit-testing (web, mobile, PDF export)
│   ├── ai-prompts/          # Versioned prompts + output schemas (backend ai module only)
│   ├── ui/                  # Web design system (React + Tailwind + shadcn/ui), Uma + Felix
│   ├── ui-native/           # Mobile design system (React Native), Uma + Mia
│   ├── design-tokens/       # Colours, type, spacing tokens -> CSS vars + RN theme (single source)
│   ├── i18n/                # Translation catalogues + formatting (dates, currency, AU first)
│   ├── time/                # IANA zones, local dates, DST-safe conversion, business days (X34)
│   ├── sync-core/           # Offline sync engine shared by mobile (and web offline later)
│   ├── auth-client/         # Session/token handling for web + mobile
│   ├── kernel/              # Backend kernel: tenant context, db client, outbox, events, errors, logger
│   ├── compose/             # Backend: the list of modules `api` and `worker` load and how they are wired (`loadModules`)
│   ├── testing/             # Factories, fixtures, test db helpers
│   ├── config-eslint/       # Shared lint config incl. boundary rules
│   ├── config-ts/           # Shared tsconfig bases
│   └── config-tailwind/
│
├── infra/                   # IaC (Owen): Terraform, per account, environment and cell (docs/infrastructure/)
├── db/                      # Migrations (single ordered history), seeds, RLS policies
├── tools/                   # Codegen scripts, CLI helpers
│   └── load/                # k6 load tests for the 100k-user profile (scaling.md §1)
├── docs/ -> project docs live in /docs (this tree)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Why `modules/` sits outside `apps/api`: `api` and `worker` (and later extracted services) both load the same modules. A module is a package (`@archova/mod-rfis`) with its own tests and its own public interface.

## 2. Inside a backend module

Every module has the same shape. Ben owns the template; this is the required skeleton.

```
modules/rfis/
├── src/
│   ├── index.ts              # PUBLIC interface: the only file other modules may import
│   ├── api/                  # HTTP layer (thin)
│   │   ├── routes.ts         # Fastify route registration, bound to OpenAPI operationIds
│   │   └── mappers.ts        # domain <-> API DTO mapping
│   ├── application/          # Use cases (commands + queries); transactions start here
│   │   ├── commands/         # createRfi.ts, respondToRfi.ts, closeRfi.ts ...
│   │   └── queries/          # listRfis.ts, getRfi.ts ...
│   ├── domain/               # Entities, value objects, rules, domain events. No I/O.
│   │   ├── rfi.ts
│   │   ├── rfi-status.ts
│   │   └── events.ts         # RfiCreated, RfiResponded, RfiClosed ...
│   ├── infra/                # Repositories (Drizzle/Prisma), external adapters
│   │   └── rfi.repository.ts
│   ├── jobs/                 # BullMQ processors owned by this module (e.g. due-date reminders)
│   ├── subscribers/          # Handlers for other modules' events
│   └── permissions.ts        # Permission keys this module defines (rfis.read, rfis.respond ...)
├── db/                       # This module's tables (schema files); migrations generated to /db
├── test/
│   ├── unit/                 # domain + application with fakes
│   └── integration/          # against real Postgres with RLS on
└── package.json
```

Layer rules (enforced with `eslint-plugin-boundaries` / dependency-cruiser in CI):

- A module's `domain/` layer imports nothing outside itself and the shared `@archova/domain` package.
- `application` imports `domain`, its own `infra` via interfaces, and other modules **only via their `index.ts`**.
- `api` imports `application` only. No DB access from routes.
- No module imports another module's tables, repositories or internal files. Cross-module reads go through the other module's public queries or a read model built from its events.

## 3. Web app structure (`apps/web`)

Felix owns the detail in `docs/frontend/`; these are the shared rules.

```
apps/web/
├── app/                              # Next.js App Router: routing + layouts only
│   ├── (auth)/login/ ...
│   ├── (app)/[orgSlug]/
│   │   ├── layout.tsx                # org shell: nav, org switcher
│   │   ├── projects/[projectId]/
│   │   │   ├── layout.tsx            # project shell: tool nav
│   │   │   ├── rfis/page.tsx         # thin: renders <RfiListScreen/> from features/rfis
│   │   │   └── ...
│   └── api/                          # ONLY auth callbacks + BFF glue; no business logic
├── features/                         # Feature slices mirror backend modules
│   ├── rfis/
│   │   ├── screens/                  # Page-level compositions
│   │   ├── components/               # Feature-specific components
│   │   ├── hooks/                    # Data hooks (TanStack Query over api-client)
│   │   ├── forms/                    # Form schemas reuse zod from @archova/contracts
│   │   └── index.ts
│   ├── documents/ ...
├── shared/                           # App-wide hooks, layout pieces, providers
└── lib/                              # api-client setup, auth, telemetry
```

Rules: pages are thin; features never import each other's internals (only `index.ts`); generic UI comes from `@archova/ui`, never re-implemented in a feature; all server data goes through the generated `api-client`, never hand-written `fetch`.

## 4. Mobile app structure (`apps/mobile`)

Mia owns the detail in `docs/mobile/`. Same feature-slice layout as web (`features/rfis/...`), using Expo Router for `app/`, `@archova/ui-native` for components, and `@archova/sync-core` for local data. Feature names and folder names match web and backend modules one to one, so a developer can move between the three.

## 5. Dependency rules between workspaces

```
apps/web, apps/mobile, apps/admin  ──►  packages/{api-client, contracts, domain, query, routes, markup, ui*, design-tokens, i18n, sync-core, auth-client}
apps/api, apps/worker, apps/realtime ──► modules/*  ──►  packages/{kernel, contracts, domain, markup, ai-prompts}
```

- Frontend apps **never** import `modules/*` or `packages/kernel`.
- Pure-TS shared packages (`domain`, `query`, `routes`, `markup`, `sync-core`, `api-client`, `contracts`) never import `react-dom`, `next/*`, `react-native`, Node-only APIs or the database (lint-enforced).
- Backend **never** imports `ui*`, `sync`, `api-client`.
- Front and back share only `packages/contracts` (OpenAPI + generated types/schemas) and the pure rule packages `domain` and `markup`.
- Final package list and rationale: [ADR-0006](adr/0006-shared-client-packages.md).

## 6. Build, CI and codegen

- `pnpm turbo run lint typecheck test build --filter=...[origin/main]` runs only what changed.
- Codegen pipeline: edit `packages/contracts/openapi/*.yaml` → `pnpm gen` produces TS types, zod schemas and `api-client`. CI fails if generated code is stale.
- Migrations live in `/db/migrations` as one ordered history (Ben). Each module owns its schema files; the migration tool composes them.
- Owen owns CI/CD detail in `docs/infrastructure/`.
