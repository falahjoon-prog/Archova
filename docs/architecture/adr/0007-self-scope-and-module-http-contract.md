# ADR-0007: Self-scope reads, and how modules plug into the API

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Ava (architecture). Built in the phase 0 foundations PR; Ben and Sam to review.
- **Affects:** backend (kernel, platform, every module's `api/routes.ts`), security (tenant isolation), web, mobile

## Context
Building the foundations surfaced two gaps in the docs.

1. `GET /v1/me` must list every org a user belongs to before any org is chosen. Every tenant table is behind RLS keyed on `app.org_id` (ADR-0003), and the application role has no `BYPASSRLS`, so there was no sanctioned way to read a user's memberships across orgs.
2. Backend 01 said modules register Fastify routes bound to operationIds. Letting each module own Fastify code would spread authentication, tenant resolution, entitlement and validation across modules, which is where leaks happen.

## Decision

### Self scope
- A third transaction kind next to tenant and global: `database.withSelfTx(userId, fn)` in `@archova/kernel`. It is read-only, sets `app.org_id` to the nil UUID (matches no tenant row) and `app.self_user_id` to the caller.
- Only explicit `self_read` policies honour it: `platform.memberships` and `platform.project_members` rows where `user_id = kernel.self_user_id()`, and the `platform.orgs` rows those point to. No other table has a self policy, so everything else returns zero rows.
- Used by `GET /v1/me` only. Adding a `self_read` policy to another table needs an ADR amendment and Sam's review.

### Module HTTP contract
- Modules export a route table keyed by OpenAPI `operationId` (`defineRoutes` in `@archova/kernel/http`). Handlers receive already-validated `params`, `query` and `body` plus `principal` and `tenant`, and return `{ status, body, headers, setCookies, redirect }`. Modules never import Fastify.
- `apps/api` owns the pipeline from backend 02 §1 for every operation in the contract: host → credential rules (ADR-0004), CSRF, zod validation generated from the contract, tenant from the URL path, entitlement by the operation's `x-module`, and `x-permission` (a permission key evaluated by `access` against the path's `projectId`, if any). It refuses to start if an operation has no handler or no `x-module`.
- Use cases still call `access.assert` for checks that depend on the record (company scoping, item privacy, uploads whose target module is in the body).

### Smaller choices made while building
- The `__Host-sid` cookie carries a random 256-bit token; `identity.sessions` stores its SHA-256 (`token_hash`) and keeps `id` as the `sid` used in bearer tokens. A database read never yields a usable cookie.
- OAuth authorisation codes live in `identity.oauth_codes` (single use, 60 s, burned before PKCE is checked). The first-party client is `archova-mobile` with redirect `com.archova.app:/oauth/callback`.
- Problem `type` is `urn:archova:problem:<code>` until the public docs domain exists.
- Until `apps/worker` exists, `POST /v1/orgs/{orgId}/uploads/{uploadId}/complete` verifies size and SHA-256, scans and moves the file out of quarantine inline. The worker takes over from the S3 event using the same `files` function. The API refuses to start in production without a malware scanner.
- `billing` ships as a placeholder module returning trial entitlements so the entitlement step is wired end to end; Sam replaces the provider.

## Alternatives considered
- **A SECURITY DEFINER function for `/me`:** tables use `FORCE ROW LEVEL SECURITY`, so the owner is also subject to RLS; a definer function would need a `BYPASSRLS` owner, which ADR-0003 rules out.
- **Store org ids in the session:** stale as soon as membership changes, and X4 says the org never comes from tokens.
- **Modules registering Fastify routes directly:** each module would re-implement the pipeline, and a missed step is a tenant leak.

## Consequences
- Tenant-isolation tests cover the self policies (an external collaborator sees exactly the orgs they belong to).
- Ben's module template (`pnpm gen:module`) generates `api/routes.ts` against `defineRoutes`.
- Sam reviews the self policies and the identity token handling as part of the identity review ADR-0005 requires.
