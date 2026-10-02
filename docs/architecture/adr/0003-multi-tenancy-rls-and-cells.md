# ADR-0003: Shared-schema multi-tenancy with RLS, scaled out by cells

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Ava, Ben, Sam
- **Affects:** backend, security, devops, AI

## Context
We expect ~10,000 tenant organisations (most small) and must make cross-tenant data leaks practically impossible. A few enterprise or government customers will want stronger isolation or other regions.

## Decision
- Shared database and shared schema; every tenant row carries `org_id`.
- Postgres row-level security (`ENABLE` + `FORCE`) on every tenant table, keyed by `current_setting('app.org_id')`, set with `SET LOCAL` per transaction. The application role has no `BYPASSRLS`.
- The org for a request comes from the **URL path** (`/v1/orgs/{orgId}/...`) and is verified against the caller's membership; it is never taken from the request body or baked into tokens.
- Caches, search indexes, vectors and S3 keys are tenant-prefixed or tenant-filtered by the owning module.
- Scale-out and enterprise isolation through **cells** (full stack copies) behind a global tenant directory.

## Alternatives considered
- **Schema per tenant:** 10,000 schemas make migrations and connection pooling painful.
- **Database per tenant:** strongest isolation, highest cost; offered only as a dedicated cell for enterprise.

## Consequences
- CI must reject tenant tables without RLS and run cross-tenant leakage tests.
- No cross-org foreign keys, so orgs can move between cells.
- Reporting across tenants (internal analytics) uses a separate pipeline, never the app role.
