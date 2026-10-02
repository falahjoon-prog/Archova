# Multi-tenancy, permissions and licensing hook

**Owner:** Ava (model), Sam (security + licensing detail), Ben (implementation) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Tenant model

```
Organization (tenant, the paying customer, e.g. a builder)
 ├── Memberships  (users who belong to the org, with an org role)
 ├── Companies    (directory: the builder itself, subcontractors, consultants, clients)
 └── Projects
      └── ProjectMembers (user + company + project role)
```

- **The tenant is the Organization.** Every tenant-owned row carries `org_id`.
- **Users are global** (one login, one email) and can belong to many orgs. A subcontractor working for three builders has one account and sees three orgs. This is key to the "subbies join free" wedge.
- **Cross-org collaboration:** a subcontractor's company record lives in the builder's org directory; the subbie user is invited as a project member of the builder's project. Data stays in the builder's tenant. A subbie's own org (if they're also a paying customer) is a separate tenant; no data is shared between tenants except through explicit features (e.g. a future "share claim to subcontractor's org" which copies data with an audit record).

## 2. Isolation strategy

**Shared database, shared schema, `org_id` on every row, enforced by Postgres row-level security (RLS).** ([ADR-0003](adr/0003-multi-tenancy-rls-and-cells.md))

```sql
ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rfis
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);
```

- The app connects as a role **without** `BYPASSRLS`. Each request/job runs in a transaction that starts with `SET LOCAL app.org_id = '<org>'` (and `app.user_id` for audit). Missing setting → the policy errors, so a forgotten tenant context fails closed.
- Global tables (users, plans, SOPA state rules, public holidays) have no RLS and are read-only to tenant code.
- A separate migration/admin role with `BYPASSRLS` is used only by migrations and the audited back-office (`apps/admin`), never by `api` or `worker`.
- Every composite index on tenant tables leads with `org_id` (and usually `project_id`).
- Automated test: a suite runs every repository query under org A with seeded data in org B and asserts zero leakage; runs in CI.
- **Caches, search and vectors are tenant-scoped too:** Redis keys prefixed `org:{orgId}:`; OpenSearch documents carry `org_id` and every query is wrapped with an `org_id` filter by the `search` module; pgvector tables have RLS like any other table; S3 keys prefixed `orgs/{orgId}/`.

## 3. Tenant context

`packages/kernel` provides `TenantContext { orgId, userId, principalType, entitlements, requestId }` via AsyncLocalStorage. Set by the API tenant plugin and by the job runner from job payload. Repositories obtain DB connections only through the kernel, which applies `SET LOCAL`. Code cannot get a raw connection without a tenant context except in explicitly marked system jobs.

## 4. Cells (scale-out and enterprise isolation)

A **cell** is a full copy of the data and application tier (Aurora cluster, Redis, OpenSearch domain, ECS services) serving a subset of orgs. A thin global layer holds:

- the **tenant directory** (org → cell, region),
- global identity (users, sessions, SSO config),
- billing account records.

Routing: the edge/router resolves `orgId` → cell and forwards. Users with orgs in different cells see them all through `/v1/me`, which fans out to the global directory.

Phases: one cell until ~30–50k active users or a single Aurora writer approaches 60% sustained CPU; then add cells and place new orgs by size. **Enterprise / government** customers can get a dedicated cell (their own database), which is also the path for other regions' data residency (NZ, UK, US).

Moving an org between cells is an offline-per-org export/import with a short read-only window; design for it from day one by keeping every tenant row keyed by `org_id` and avoiding cross-org foreign keys.

## 5. Permissions model

- **Org roles:** Owner, Admin, Member, Guest (external).
- **Project roles** assigned via **permission templates** (e.g. "Project Manager", "Site Manager", "Subcontractor", "Client / Superintendent"), each a map of `module → level` (`none | read | standard | admin`) plus granular overrides (`financials.claims.approve`).
- **Company scoping:** for external users, list and read access is further limited to items where their company is a party (assignee company, distribution list, contract payee).
- **Item-level privacy:** some items (private RFIs, confidential correspondence) carry explicit ACLs.
- The `access` module evaluates `can(principal, action, resource)` and exposes a **query filter builder** so list endpoints apply permission filters in SQL instead of post-filtering.
- Permission decisions are cached per (user, project) in Redis with event-driven invalidation on membership/role changes.

## 6. Licensing and entitlements hook

Sam defines the commercial model in `docs/security-licensing/`. The architecture only fixes how features consume it:

- `billing` computes an **entitlement set** per org: enabled modules (`financials`, `quality`, `ai.assistant`...), limits (projects, storage GB, AI credits/month, API calls), and seat/licence rules.
- Entitlements are cached (Redis, short TTL + invalidation event `billing.entitlements.changed.v1`) and loaded into the tenant context per request.
- API plugin rejects calls to unlicensed modules with `403` problem type `entitlement-required`. UI reads `/v1/orgs/{orgId}/entitlements` to hide or upsell features.
- Usage-metered features (AI, storage, API) emit usage events to `billing`, which aggregates counters and enforces soft and hard limits.
- Per-company pricing with free subcontractor access (plan §1) means licensing is **per org and per project/value tier, not per seat** by default; the entitlement model supports seat counts too if Sam's model needs them.
