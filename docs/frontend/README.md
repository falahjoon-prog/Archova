# Web frontend design

**Owner:** Felix (Web Frontend Engineer) · **Status:** Draft v1.1 (aligned with [cross-team decisions](../architecture/cross-team-decisions.md)) · **Last updated:** 2 Oct 2026

How the Next.js web app is structured and built. It sits on Ava's architecture ([overview](../architecture/overview.md), [repo-structure](../architecture/repo-structure.md), [api](../architecture/api.md)) and Uma's design system ([design/](../design/README.md)), and shares its client layer with Mia's mobile app ([mobile/](../mobile/README.md)). No code yet; this is the agreement we build to.

## Documents

| Doc | Covers |
|---|---|
| [01-structure.md](01-structure.md) | Packages used, `apps/web` layout, feature folders, component layers, import boundaries |
| [02-state-and-data.md](02-state-and-data.md) | Where each kind of state lives, server-render then TanStack Query, mutations, realtime, forms, permissions and licensing in the UI, AI surfaces, errors |
| [03-routing.md](03-routing.md) | URL scheme, layout tree, auth and tenant guards, navigation, deep links shared with mobile |
| [04-shared-api-clients.md](04-shared-api-clients.md) | What web and mobile share, the generated client, platform adapters, versioning |
| [05-performance-and-scale.md](05-performance-and-scale.md) | Web Vitals and bundle budgets, rendering strategy, not generating load, large tenants, observability, accessibility |
| [06-testing.md](06-testing.md) | Test pyramid, critical journeys, conventions, environments |

## Key decisions

1. **Thin routes, fat features.** `app/` only routes and lays out; each product module is a `features/<module>` folder named the same as the backend module and the mobile feature.
2. **Four component layers:** tokens, primitives, patterns (all in `packages/ui`, no data fetching), then features. Import boundaries are lint-enforced.
3. **Server data lives in the query cache, not a global store.** First paint is server-rendered and hydrated; TanStack Query keeps it fresh; filters live in the URL; Zustand only for small cross-screen UI state.
4. **Nothing with legal or money weight is optimistic.** Claims, payment schedules, variations and transmittals wait for the server, and step-up auth where Sam requires it.
5. **One generated client for web and mobile**, with idempotency keys, ETags and typed errors handled once in the wrapper.
6. **Realtime is a hint, not data:** socket events invalidate mounted queries only, one socket shared per browser.
7. **AI output is always a draft a person confirms**, with sources shown; models are only reached through the API.
8. **Budgets in CI:** LCP under 2.5 s and INP under 200 ms at p75 on a mid-range Android phone, JS per route capped.

## Settled with the team

- Web session is the opaque `__Host-sid` cookie; the browser calls the API same-origin at `app.<domain>/v1/*` and `/realtime`, with CSRF covered by an `Origin` check plus `X-CSRF-Token` ([ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md)).
- `query`, `routes` and `markup` packages accepted; permission checks live in `domain`, which replaces `domain-types` ([ADR-0006](../architecture/adr/0006-shared-client-packages.md)).

## Needs from others

| Who | What |
|---|---|
| Ben | Problem-detail `code` list and permission keys exported in `contracts`/`domain`, so the UI can map errors and gate actions. |
| Uma | Component specs for the patterns layer (DataTable, FilterBar, EntityHeader, MoneyInput, AI suggestion label). |
| Owen | Same-origin path rules; Lighthouse CI and size-limit in the pipeline; preview deploys per PR with a seeded tenant. |
