# 02. Multi-tenancy, authentication, permissions and licensing: implementation

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

The model and rules are set elsewhere: tenant model and cells in [architecture/multi-tenancy.md](../architecture/multi-tenancy.md) and [ADR-0003](../architecture/adr/0003-multi-tenancy-rls-and-cells.md); isolation in Sam's [03](../security-licensing/03-tenant-isolation.md); sessions in [ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md) and Sam's [01](../security-licensing/01-authentication-sso.md); identity in [ADR-0005](../architecture/adr/0005-identity-in-house-module.md); permissions in Sam's [02](../security-licensing/02-roles-permissions.md); licensing in Sam's [04](../security-licensing/04-licensing-model.md) and [06](../security-licensing/06-license-enforcement.md). This doc says how the backend code implements them.

## 1. Request pipeline (Fastify plugins, in order)

| # | Plugin | Does | Fails with |
|---|---|---|---|
| 1 | `requestContext` | request id, trace id, AsyncLocalStorage context | |
| 2 | `authenticate` | `__Host-sid` cookie (origin `app.<domain>` only) **or** `Authorization: Bearer` (origin `api.<domain>` only) → `Principal { userId, sessionId, client, authMethod, authTime }`. Session/`sid` checked against Redis on every request (instant revocation). CSRF: `Origin` + double-submit token on unsafe cookie requests (ADR-0004 §5) | 401 `auth.unauthenticated`, 401 `auth.session_revoked`, 403 `auth.csrf_failed` |
| 3 | `tenant` | `orgId` **from the URL path**; verify the principal has a membership in that org or an active `project_members` row on the target project (external collaborator). Sets `TenantContext { orgId, userId, principalType, isExternal, entitlements, requestId }` | 404 `org.not_found` (never 403, so existence isn't confirmed) |
| 4 | `entitlement` | route → module mapping from the registry; `module.<x>` must be on, and subscription state must allow the action class (`read`, `write`, `admin`, `export`) | 403 `entitlement-required`, 403 `org.read_only` |
| 5 | `validate` | request validated by zod generated from the OpenAPI operation | 422 `validation_failed` |
| 6 | `rateLimit` | per token, per user, per org (Redis); per-plan `limit.api_rpm` for public API | 429 |
| 7 | handler | opens `withTenantTx`, runs the use case, maps the result | |

The org is never read from a token or body (X4). Mobile JWTs carry no org claim, so one token works across every org the user belongs to.

## 2. Row-level security implementation

Tenant context is **transaction-scoped**: every request and every job runs inside one transaction that begins with

```
BEGIN;
SET LOCAL app.org_id  = '<uuid>';
SET LOCAL app.user_id = '<uuid>';
SET LOCAL statement_timeout = '5s';   -- 60s in jobs
```

`SET LOCAL` ends with the transaction, so a pooled connection (RDS Proxy / PgBouncer, transaction mode) can never carry one tenant's context into the next request. Session-level `SET` is banned by lint. The kernel is the only way to get a connection, and it refuses to hand one out without a `TenantContext` unless the caller is a declared platform job.

Policy created for every tenant table by `kernel.enable_tenant_rls()`:

```
ALTER TABLE rfis.rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis.rfis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rfis.rfis
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);
```

`current_setting` without `missing_ok` errors when the setting is absent, so a forgotten context fails closed.

### Database roles (Sam 03 §3)

| Role | Used by | Rights |
|---|---|---|
| `app_rw` | `apps/api`, `apps/worker` (tenant jobs) | DML on module schemas; not table owner; no `BYPASSRLS`; `INSERT`/`SELECT` only on `audit.*` |
| `app_platform` | declared platform jobs only (usage roll-ups, ACV tracking, SOPA deadline scan) | `SELECT` on specific narrow views (e.g. `financials.v_open_claim_deadlines(org_id, claim_id, due_on)`), every use logged; fans out per-org jobs that then run as `app_rw` |
| `app_migrator` | CI/CD migrations | owns schemas and tables |
| `app_admin` | `apps/admin` back-office | audited; support access is itself an audit event |
| `readonly_analytics` | CDC / analytics export | replica only |

**Deliberate exception (outbox relay, PR #73):** `app_platform` also has column-limited `SELECT (id, org_id, type, occurred_at, published_at)` and `UPDATE (published_at)` on `shared.outbox` with two narrow policies (read; set unpublished to published only). No payload columns, insert or delete. Sam approved.

**Deliberate exception (scheduled-job org scan):** `app_platform` also has `SELECT (id, timezone, deleted_at)` on `platform.orgs` with one policy (`deleted_at is null`), so the scheduler can list live orgs and fan out one job per org. Each job then runs as that org through `withTenantTx`. Pending Sam review.

### Cross-org collaborators

A project belongs to exactly one org. A subcontractor user calling `/v1/orgs/{builderOrgId}/projects/{p}/defects` is authorised by their `project_members` row, and the transaction runs with `app.org_id = builderOrgId`. Their own org's data is never in scope of that request.

### Other stores
Redis keys through the kernel helper only (`t:{orgId}:…`); BullMQ payloads require `orgId` unless the job is declared platform; OpenSearch and `ai.ai_chunks` queries are wrapped with org + access-scope filters by the `search`/`ai` modules; S3 keys always under the org prefix ([06](06-file-storage.md)).

## 3. Authentication plumbing

Behaviour is Sam's; these are the backend pieces.

| Client | Credential | Backend handling |
|---|---|---|
| Web (`app.<domain>`) | `__Host-sid` opaque session cookie | `identity.sessions` (durable) + Redis hot copy; idle 12 h, absolute 30 days; no JWT in the browser |
| Next.js server components | forwards the user's `__Host-sid` over the internal address | validated exactly like a browser call |
| iOS / Android (`api.<domain>`) | OAuth 2.1 code + PKCE → **10-minute ES256 access JWT** (`sub`, `sid`, `client`; no roles, no org) + opaque rotating refresh token | JWKS cached in-process; `sid` checked in Redis revocation set; refresh-token reuse detection by `family_id` |
| Public API | OAuth apps, service accounts, personal access tokens | scopes map to permission keys (`rfis:read`); tokens stored hashed |
| Realtime | web: cookie on upgrade + strict `Origin`; mobile: token in first message | `apps/realtime` subscribes to the revocation channel and closes sockets |
| Step-up | sensitive actions (submit payment claim, issue schedule, change SSO) | use case checks `authTime` / `authMethod`; 403 `auth.step_up_required` |

`identity` is a global module ([ADR-0005](../architecture/adr/0005-identity-in-house-module.md)) with its tables listed in [schema/platform.md](schema/platform.md#identity-global-lives-in-the-cells-global-layer). SSO/SCIM sit behind the `IdentityProvider` interface so WorkOS can replace that part later.

## 4. Permission engine (`access` module)

Implements Sam 02 §5 in this order: session → tenant → entitlement → org policy → tool level → company scoping → item privacy → state rules. First deny wins; default deny.

- **Effective permission set** per `(user, project)`: tool levels, granular flags, user's `company_id`, company-scoped tools, `isExternal`. Built from `access.permission_templates` + `access.project_member_overrides`, cached in Redis at `t:{org}:perm:{user}:{project}:{v}` (15 min). `{v}` comes from `access.cache_versions` via one `MGET`; template edits, member changes and entitlement changes bump the version.
- **Public API of the module:**
  - `access.assert(ctx, key, resource)` for single-record actions;
  - `access.listFilter(ctx, tool, projectId)` returns a SQL fragment (project membership, `*_company_id = $company` for company-scoped tools, `is_private = false OR id IN (acl)`), so lists, counts and pagination never leak;
  - `access.summary(ctx, projectId)` for the UI (`GET …/projects/{p}/permissions`).
- **Same check everywhere:** API, jobs, search, exports, notifications, webhooks, AI retrieval. Notification fan-out evaluates the recipient's permissions, not the actor's.
- Each module declares its tool, permission keys (`<module>.<resource>.<action>`), the company-scoping column, and entity types in `permissions.ts`; the generator writes the key list into `packages/contracts` for web/mobile.

## 5. Entitlements and licensing in code (`billing` module)

- `billing.entitlements` is materialised per org (see [schema/billing.md](schema/billing.md)); cached at `t:{org}:ent:{v}`; loaded into `TenantContext` by the tenant plugin.
- **Route level:** every route belongs to a module in one registry; CI fails if a route has none. Unlicensed → 403 `entitlement-required` with the missing key, so web/mobile can show an upgrade prompt.
- **Subscription state → action class** (Sam 06 §3): `read_only` denies `write` except replies to items addressed to external collaborators and billing changes by the owner; mobile in `read_only` syncs down only. `cancelled` allows owner/admin export only.
- **Limits** (Sam 06 §5): `limit.active_projects` and `limit.seats` are checked in the create-project and invite commands; storage checked at `POST /uploads`; ACV never blocks.
- **Meters:** AI calls reserve credits (`billing.reserveCredits`) and settle after the call; storage, API calls and active workers are recorded as `billing.usage_records` by jobs with idempotency keys.
- **Dropped module data** stays readable and exportable; nothing is deleted on downgrade.
- **SOPA reminders always run**, whatever the subscription state (they protect the customer's legal position).
