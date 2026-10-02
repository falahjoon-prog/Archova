# ADR-0006: Final set of shared packages

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Ava. Proposals from Felix (web), Mia (mobile), Ari (AI).
- **Affects:** repo structure, web, mobile, backend, AI

## Context
Package names drifted between architecture (`domain-types`, `sync`), web (`domain`, `query`, `routes`, `permissions`), mobile (`domain`, `sync-core`, `markup`) and AI (`ai-prompts`). One list is needed.

## Decision
Shared packages under `packages/`, scope `@archova/*`:

| Package | Contents | Used by | Rules |
|---|---|---|---|
| `contracts` | OpenAPI spec, generated types and zod schemas, event schemas, problem `code` list, permission key list | all | Ben owns the spec |
| `api-client` | Generated client + thin `createApiClient` wrapper | web, mobile, admin | no platform imports |
| `domain` | **Replaces `domain-types`.** IDs and prefixes, money, enums, status state machines, validators, business-day/SOPA date rules and holiday tables, and client-side `can()` / `hasModule()` under `@archova/domain/permissions` | web, mobile, **and backend modules** | pure TS; **absorbs the proposed `permissions` package** |
| `query` | TanStack query key factories and `queryOptions()` per resource | web, mobile online-only reads | depends only on `api-client` + `@tanstack/query-core` |
| `routes` | Typed route and deep-link builders | web, mobile, notification/email templates | pure TS |
| `markup` | Drawing markup shape schema, geometry, hit-testing, normalisation | web, mobile, backend PDF export | pure TS |
| `sync-core` | **Renamed from `sync`.** Offline engine: device outbox, pull loop, conflict handling | mobile (web later) | pure TS, no React |
| `auth-client` | Session/token handling with web and mobile adapters | web, mobile | |
| `design-tokens`, `ui`, `ui-native`, `i18n` | as in repo-structure | | |
| `ai-prompts` | Versioned prompt templates, output schemas, eval links | backend `ai` module only | never imported by clients |
| `kernel`, `testing`, `config-*` | as in repo-structure | | |

"Pure TS" means no React, `react-dom`, `next/*`, `react-native`, Node-only or browser-only APIs, and no DB access; enforced by lint in CI.

## Consequences
- Backend modules may import `domain` (so server and client run the same rules); the server stays the authority.
- Felix and Mia update their package tables to these names; `domain-types` and `sync` are retired.
- `permissions` is a folder in `domain`, not its own package.
