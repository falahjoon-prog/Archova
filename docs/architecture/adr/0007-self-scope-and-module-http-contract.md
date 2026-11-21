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

## Amendment 1 (20 Nov 2026): contractor links (X64)

- **Status:** Accepted, 20 Nov 2026 (Sam's review items 1 to 6 are written in below; his items 7 to 12 land in the code PRs with tests).
- **Why:** X64 gives a contractor one global account and one `contractors.links` row per company. The contractor must read their own links across companies (no org chosen), ask a company to link, and find a company by name. The "adding a `self_read` policy needs an ADR amendment" rule above applies.

### Decision
1. **One new self policy.** `contractors.links` gets `self_read` (select only): `contractor_user_id = kernel.self_user_id()`. The table keeps `FORCE ROW LEVEL SECURITY` and the `tenant_isolation` policy for the company side (now limited to `app_rw` and `app_migrator`). Nothing else gains a self policy. The row holds only what both sides may see: company name copied at request time, status, dates. Company-internal fields (who decided, reasons) live in `contractors.link_decisions`, which has no self policy. The contractors module reads links in self scope only through `infra/links-repo.ts`, which selects named columns; a unit test pins that file as the only one allowed to do so.
2. **Contractor writes run as a restricted role, not as a member.** Self scope stays read-only. A contractor's writes into a company they do not belong to use `database.withContractorTx(orgId, userId, fn)`: a transaction that sets `app.org_id` and then `SET LOCAL ROLE app_contractor`. That role is NOLOGIN, `app_rw` can switch to it but does not inherit it, and it holds grants on `contractors.links` only, with its own policies: read own rows plus pending rows of that company (to count the cap), insert and update own row only. It cannot read any other table, in that company or any other (integration test), and no `access` check treats it as a member (principal type `contractor`). Only `infra/links-repo.ts` may call it (unit test over the whole repo). The org id comes from a server-side directory lookup (listed, not deleted), never from the request.
3. **Rows are never deleted by the contractor.** The contractor may cancel their own `requested` row (status `cancelled`) and end their own `accepted` row (`ended`); both are status changes. `rejected` stays and blocks a new request for 30 days; a company can set `blocked`, which is permanent and shown to the contractor as a rejection. A new request after `cancelled`, `ended` or an expired rejection updates the same row (unique index), so the cooldown cannot be dodged by deleting.
4. **Company search uses an opt-in global directory, not `platform.orgs`.** `contractors.directory` (global layer, on the RLS lint allow-list, only the contractors module reads it) holds `company_id`, an opaque `listing_id` (what the client sees, never the org id), `name`, `abn_last3` and `listed`. `listed` is **false by default** and a company turns it on in its Contractors page. A plain trigger (not security definer) on `platform.orgs` copies name and ABN digits, never touches `listed`, and removes the row when the org is deleted. Search: verified email required (the switch is off until email verification exists, see consequences), at least 3 characters, 10 rows, no totals or paging; 20 a minute, 200 a day (30 for an account under a day old), counted in Redis so every instance shares it; a warning is logged when one account tries 40 distinct terms in a day.
5. **Contractor account.** A contractor is an `identity.users` row plus a `contractors.profiles` row (global layer, always filtered by the caller's user id). No membership, so `GET /v1/me` returns no orgs. Contractor routes live under `/v1/me/contractor/...` and use `principal.userId` only. `contractors` is a core module (every plan), and a fourth owner of `withGlobalTx`.
6. **Abuse caps.** At most 50 open requests per contractor (counted across companies in self scope; two simultaneous requests can overshoot slightly, which is accepted) and 100 waiting requests per company (counted under the restricted role). Step 1 sends no notification to the company, so the notification throttle arrives with the first notification.

### Consequences
- Tenant-isolation tests: a contractor sees only their own links; another contractor's link ids return nothing; a company sees only its own links; a normal self transaction (`/v1/me`) still sees no links; the self policy returns the link columns and nothing from `link_decisions`.
- Sign-up does not verify email addresses yet (`email_verified_at` is never set), so the verified-email gate ships switched off (`requireVerifiedEmail`). It must be switched on before the contractor portal is offered to anyone outside the pilot.
- Existing orgs get a directory row when they first turn listing on, because a migration cannot read tenant tables.
- Step 1 contains no payments and no company data beyond the link row. Jobs, chat and quotes shared with an accepted contractor arrive later, must be gated on an `accepted` link, and need their own review.
