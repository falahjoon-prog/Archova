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

- **Status:** Proposed. Needs Sam's review before any code that uses it merges.
- **Why:** X64 gives a contractor one global account and one `contractors.links` row per company. The contractor must read their own links across companies (no org chosen), and must be able to ask a company to link and to find a company by name. The "adding a `self_read` policy needs an ADR amendment" rule above applies.

### Decision
1. **One new self policy.** `contractors.links` gets `self_read` (select only): `contractor_user_id = kernel.self_user_id()`. The table is still `FORCE ROW LEVEL SECURITY` with the usual `tenant_isolation` policy for the company side. Nothing else gains a self policy. The contractor reads only the link row: company id, company display name copied onto the link at request time, status and dates. They never read `platform.orgs`, projects or any company record through it.
2. **Contractor writes go through the target org's tenant transaction, never self scope.** Self scope stays read-only. The contractors use case that handles "request a link", "cancel my request" and "end my link" opens `withTenantTx` for the named company and may only: insert a `requested` row for the caller; delete or end a row whose `contractor_user_id` is the caller. It never reads any other row in that org. The org id comes from the directory (item 3), never from the client. The company's own accept/reject routes are ordinary org-scoped routes behind org admin/owner role checks.
3. **Company search uses a narrow global directory, not `platform.orgs`.** `contractors.directory` (global layer, no RLS, only the contractors module's repositories read it) holds `org_id`, `name`, `abn_last3` and `listed`, kept in step with `platform.orgs` by an `after insert or update` trigger. It cannot expose anything else because it has nothing else. `platform.orgs` policies are unchanged. Search needs a signed-in contractor account, a query of at least 3 characters, returns at most 10 rows, ordered by name, never total counts or paging, and is rate limited per account (20 per minute). A company can set `listed = false` later without a new policy.
4. **Contractor account.** A contractor is an `identity.users` row (normal sign-up) plus a `contractors.profiles` row (global, keyed by user id, owner only). It has no membership, so `GET /v1/me` returns it with no orgs. Contractor routes live under `/v1/me/contractor/...`, take no org from the path, and use `principal.userId` only. The `contractors` module is added as a fourth owner of `withGlobalTx` for the profile and directory tables.
5. **Abuse limits.** At most 50 open `requested` links per contractor; a rejected pair cannot re-request for 30 days; duplicate (company, contractor) rows are impossible (unique index). Rate limit is in-process per API instance for now; the edge WAF limit (infrastructure 04) is the real backstop.

### Consequences
- Tenant-isolation tests: a contractor sees only their own links; another contractor's link ids return nothing; a company sees only its own links; a normal self transaction (`/v1/me`) still sees no links.
- Step 1 contains no payments and no company data beyond the link row. Jobs, chat and quotes shared with an accepted contractor arrive later and must be gated on an `accepted` link by their own review.
