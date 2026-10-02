# ADR-0001: Separate API app as a modular monolith

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Ava (architecture), Ben (backend)
- **Affects:** backend, web, mobile, devops

## Context
The plan (§3) proposed running the API inside the Next.js app as route handlers. Since then the scope has grown: native iOS/Android apps, a public API and webhooks, AI workers, and a 100,000+ user target. All of those need one stable, versioned API that does not depend on the web UI's deploys or rendering capacity.

## Decision
- Build the backend as `apps/api` (Fastify, TypeScript) plus `apps/worker` and `apps/realtime`, all loading the same domain packages in `modules/*`.
- It is a **modular monolith**: strict module boundaries (own tables, public `index.ts`, domain events through an outbox), one deployable per process type.
- Next.js (`apps/web`) is a client of the API. It holds no business logic and never talks to the database.

## Alternatives considered
- **API in Next.js route handlers:** fastest start, but couples API scaling and releases to the web app, and mobile/public consumers would depend on a web framework's routing.
- **Microservices from day one:** too much operational cost and premature boundaries for a domain that is still settling.

## Consequences
- Two more deployables to run from phase 0 (Owen).
- Modules can later be extracted into services (`ai`, `files`, `search` first) without changing the public contract.
- Boundary rules must be enforced in CI (lint + dependency checks) or the monolith will erode.
