# System architecture: overview

**Owner:** Ava (Solution Architect) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026
**Source plan:** [plans/plan.md](../../plans/plan.md)

This is the entry point for everyone on the team. It fixes the decisions other areas build on. Detail lives in the linked docs; anything marked **Decision** is binding until changed by an ADR in [adr/](adr/).

The product is named **Archova** (john, 2 Oct 2026). Code uses `archova` (repo, AWS resource prefix) and npm scope `@archova/*`. Never use "Procore" in code, UI, package names or domains.

---

## 1. What we are building

A multi-tenant SaaS construction management platform reaching feature parity with Procore over phases 0 to 5 (see plan §5–6), starting with mid-size Australian commercial builders. It is used through:

- a **web app** (office: PMs, contract admins, executives),
- **iOS and Android apps** (field: site managers, foremen, subcontractors) with offline support,
- a **public REST API and webhooks** (integrations, customers' own tooling),
- **AI features** embedded across modules (document Q&A, drafting RFIs and diary entries, defect photo tagging, claim checks).

Target scale for the design: **100,000+ registered users**, ~10,000 tenant organisations, ~15,000 peak concurrent users, tens of millions of documents and photos. The design must reach that without a rewrite, and should stretch to 1M users by adding cells (see [scaling.md](scaling.md)).

## 2. Architecture at a glance

```
                ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  Clients       │ Web (Next.js)│  │ iOS / Android│  │ Public API   │  │ Webhook      │
                │              │  │ (Expo RN)    │  │ consumers    │  │ receivers    │
                └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────▲───────┘
                       │ HTTPS           │ HTTPS + sync    │ HTTPS (OAuth)   │
                ┌──────▼─────────────────▼─────────────────▼──────┐          │
  Edge          │ CloudFront + WAF  →  ALB / API Gateway layer    │          │
                └──────┬──────────────────────────────────────────┘          │
                       │                                                     │
                ┌──────▼──────────────────────────────────────────┐          │
  Application   │ api  — modular monolith (TypeScript, Fastify)   │          │
  (stateless,   │  platform │ documents │ rfis │ diary │ defects  │          │
  autoscaled)   │  financials │ quality │ ... │ ai │ billing      │          │
                └──┬──────────┬───────────┬──────────┬────────────┘          │
                   │          │ outbox     │ jobs     │                      │
                ┌──▼───┐  ┌───▼────┐  ┌────▼─────┐ ┌──▼─────────┐  ┌────────┴──────┐
  Workers       │      │  │ events │  │ workers  │ │ ai-worker  │  │ webhook-worker│
                │      │  │ relay  │  │ (pdf,    │ │ (embed,    │  │               │
                │      │  │        │  │ thumbs,  │ │ extract,   │  │               │
                │      │  │        │  │ email)   │ │ LLM calls) │  │               │
                │      │  └────────┘  └──────────┘ └────────────┘  └───────────────┘
                ┌▼──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
  Data          │ PostgreSQL    │ │ Redis    │ │ S3       │ │ OpenSearch   │
                │ (Aurora, RLS, │ │ (cache,  │ │ (files,  │ │ (search)     │
                │  pgvector)    │ │  queues) │ │  exports)│ │              │
                └───────────────┘ └──────────┘ └──────────┘ └──────────────┘
```

All of this runs in **AWS ap-southeast-2 (Sydney)**, deployed as one or more **cells** (a complete copy of the stack serving a set of tenants). Phase 0 to 2 run a single cell.

## 3. Core decisions

| # | Decision | Why | Detail |
|---|---|---|---|
| D1 | **TypeScript end to end** (API, web, mobile, workers, shared packages). | One language, shared types and validation between server and every client. | [repo-structure.md](repo-structure.md) |
| D2 | **Monorepo** (pnpm workspaces + Turborepo). | Shared contracts, one CI, atomic changes across API and clients. | [repo-structure.md](repo-structure.md) |
| D3 | **Separate API app (`apps/api`), a modular monolith**, not API routes inside Next.js. | Mobile, public API and web all need the same API; it must scale independently of web rendering. Modules can later be extracted into services without changing the contract. Supersedes plan §3 "API inside Next.js" ([ADR-0001](adr/0001-separate-api-modular-monolith.md)). | [backend-modules.md](backend-modules.md) |
| D4 | **REST + JSON, contract-first with OpenAPI 3.1**, generated typed clients for web and mobile. Same API (versioned `/v1`) is the public API. Real-time over WebSocket for notifications and presence. | Works for every client and third parties; generated clients give type safety without coupling to a TS-only RPC. ([ADR-0002](adr/0002-rest-openapi-contract-first.md)) | [api.md](api.md) |
| D5 | **Shared database, shared schema multi-tenancy** with `org_id` on every tenant table, enforced by **Postgres row-level security** plus an application tenant context. Enterprise tenants can be placed in a dedicated cell. ([ADR-0003](adr/0003-multi-tenancy-rls-and-cells.md)) | Cheapest to run at 10k tenants; RLS makes cross-tenant leaks fail closed. | [multi-tenancy.md](multi-tenancy.md) |
| D6 | **PostgreSQL (Aurora) is the system of record**; Redis for cache, rate limits and BullMQ jobs; S3 for files; OpenSearch for search; pgvector for AI embeddings. | Few, boring, managed stores. | [data-architecture.md](data-architecture.md) |
| D7 | **Domain events through a transactional outbox.** Modules talk synchronously only through each other's public service interface; side effects (notifications, search indexing, AI, webhooks, audit) react to events. | Keeps modules decoupled and makes the audit trail and webhooks reliable. | [backend-modules.md](backend-modules.md) |
| D8 | **Immutable, append-only audit log** for every write; claims and payment schedules are additionally versioned and never updated in place. | SOPA adjudication evidence (plan §2). | [data-architecture.md](data-architecture.md) |
| D9 | **Mobile: Expo / React Native, offline-first** with a local SQLite store and a sync protocol over the same API. | Field users lose signal on site; one codebase for iOS and Android. | [clients.md](clients.md) |
| D10 | **AI is a platform module (`ai`) behind an internal gateway**; feature modules call it, never an LLM vendor directly. Retrieval is tenant-scoped and permission-filtered. | Vendor swap, cost control, tenant isolation and audit in one place. | [ai-integration.md](ai-integration.md) |
| D11 | **Licensing via entitlements**: every request carries the org's plan entitlements; modules check `can(feature)` and usage limits through the `billing` module. | Lets Sam's licensing model change without touching feature code. | [multi-tenancy.md §6](multi-tenancy.md#6-licensing-and-entitlements-hook) |
| D12 | **Stateless compute on ECS Fargate**, horizontally autoscaled; all state in managed stores. Infrastructure as code. | Simple scaling path to 100k+ users. | [scaling.md](scaling.md) |
| D13 | **Web uses an opaque `__Host-sid` session and calls the API same-origin** (`app.<domain>/v1`); mobile and integrations use bearer tokens at `api.<domain>`. Identity is our own module. | Instant revocation, no tokens in the browser, no CORS; identity data stays in Sydney. ([ADR-0004](adr/0004-web-session-and-api-routing.md), [ADR-0005](adr/0005-identity-in-house-module.md)) | [api.md §4](api.md#4-authentication-and-authorisation) |
| D14 | **Shared packages fixed**: `contracts`, `api-client`, `domain`, `query`, `routes`, `markup`, `sync-core`, `auth-client`, `ui`, `ui-native`, `design-tokens`, `i18n`, `ai-prompts`. | One name per thing across web, mobile and backend. ([ADR-0006](adr/0006-shared-client-packages.md)) | [repo-structure.md](repo-structure.md) |

## 4. Doc map

| Doc | Covers |
|---|---|
| [overview.md](overview.md) | This page: context, decisions, ownership |
| [repo-structure.md](repo-structure.md) | Monorepo layout, apps, packages, folder and component structure, dependency rules |
| [backend-modules.md](backend-modules.md) | Module boundaries, layering inside a module, inter-module rules, events, jobs |
| [api.md](api.md) | API style, resources, versioning, auth, errors, pagination, real-time, public API, webhooks |
| [multi-tenancy.md](multi-tenancy.md) | Tenant model, RLS, tenant context, permissions, cells, entitlements hook |
| [data-architecture.md](data-architecture.md) | Data stores, schema conventions, files, search, audit, events, retention |
| [scaling.md](scaling.md) | Capacity model for 100k users, scaling levers, SLOs, cells, DR |
| [clients.md](clients.md) | Web, mobile and shared client packages; offline sync |
| [ai-integration.md](ai-integration.md) | How AI fits the platform: gateway, RAG, tenant safety, async processing |
| [conventions.md](conventions.md) | Shared engineering conventions every area must follow |
| [cross-team-decisions.md](cross-team-decisions.md) | Log of questions between areas and how they were settled, incl. final names |
| [adr/](adr/) | Architecture decision records (0001–0006) |

## 5. Team ownership and where each area builds on this

| Teammate | Area | Builds on | Writes to |
|---|---|---|---|
| Ava | Architecture, shared conventions | — | `docs/architecture/` |
| Ben | Backend (modules, DB schema, jobs) | backend-modules, data-architecture, multi-tenancy, api, conventions | `docs/backend/` |
| Uma | UI/UX design system | clients, conventions (naming of components/tokens) | `docs/design/` |
| Felix | Web frontend | repo-structure, clients, api | `docs/frontend/` |
| Mia | Mobile apps | clients (offline sync), api | `docs/mobile/` |
| Ari | AI features | ai-integration, data-architecture | `docs/ai/` |
| Sam | Security, licensing, billing | multi-tenancy, api (auth), data-architecture (audit) | `docs/security-licensing/` |
| Owen | DevOps, infrastructure | scaling, data-architecture, repo-structure (CI) | `docs/infrastructure/` |

**Rules for changing shared decisions:** if your area needs something that contradicts a **Decision** here, write a short ADR proposal in `docs/architecture/adr/` with status `Proposed` and flag it to Ava. Don't silently diverge.

## 6. Open questions affecting architecture

1. **Domain and bundle IDs.** Product name is settled as Archova; the registered domain (for `app.<domain>` / `api.<domain>`) and app bundle IDs (proposed `com.archova.app`) still need confirming once the domain is bought.
2. **Data residency beyond AU** (NZ, UK, US customers would mean extra regional cells; the cell design allows it).
3. **LLM vendor and AU data residency for AI** (Ari to confirm; the gateway allows swapping. Prefer a provider offering in-region processing, e.g. via AWS Bedrock Sydney).
4. **SSO requirement timing** (SAML/OIDC for enterprise builders; designed in from phase 0 via our own identity module, enabled per plan).
