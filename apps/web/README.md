# @archova/web

The Archova web app: Next.js 15 App Router, TanStack Query and the shared `@archova/*` client packages.
Conventions live in `docs/frontend/` (structure, state and data, routing, shared API clients) and
[ADR-0004](../../docs/architecture/adr/0004-web-session-and-api-routing.md) (sessions and same-origin `/v1`).

## Run locally

Needs Node 22, pnpm 10, and Postgres + Redis running locally (see `apps/api/.env.example`).

```sh
pnpm install
pnpm db:reset                      # create roles/database and run migrations (destroys local data)
cp apps/api/.env.example apps/api/.env   # set API_FILES_STORE=memory if MinIO isn't running
pnpm --filter @archova/api dev     # API on http://localhost:4000
pnpm --filter @archova/web dev     # web on http://localhost:3000
```

Open http://localhost:3000, create an account, create an organisation, then a project.

In development, `next dev` rewrites `/v1/*` and `/.well-known/*` to the API, so the browser stays same-origin
(first-party `__Host-sid` cookie, no CORS). The proxy sends `X-Forwarded-Host: localhost:3000`, which the API
accepts because `API_TRUST_PROXY=true` and `API_APP_ORIGINS=http://localhost:3000`. In deployed environments there is
no rewrite: CloudFront/ALB routes `/v1/*` on the app origin straight to `apps/api`.

## Environment variables

| Variable               | Default                 | Used for                                                                                   |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `WEB_API_INTERNAL_URL` | `http://localhost:4000` | Target of the development `/v1` and `/.well-known` rewrites. Ignored in production builds. |

The browser needs no API URL: it always calls same-origin `/v1/...`.

## Scripts

`dev`, `build`, `start`, `lint` (ESLint with the shared `frontend` config, Next and react-hooks rules, and feature
boundary rules), `typecheck`, `test` (Vitest).

## Structure

```
app/                     routes only; each page renders one feature screen
  (auth)/login, signup   sign-in and sign-up
  (app)/orgs, orgs/new   organisation picker and "new organisation"
  (app)/[orgSlug]/       org shell (slug → org id via GET /v1/me; 404 when not a member)
    projects/            project list + new project form
    projects/[projectId] project detail, members, add member (if allowed)
features/<name>/         screens/, components/, forms/, hooks/, lib/, index.ts (public surface)
  auth/ orgs/ projects/
shared/
  lib/                   api client (createApiClient + createWebSession), error mapping, form helpers
  providers/             QueryClient, session bootstrap (CSRF token), current org context
  layout/                app shell, centred shell, error and loading states
middleware.ts            redirects to /login?next=… when there is no __Host-sid cookie; nothing else
```

Rules (lint-enforced): features import each other only through `@/features/<name>` (their `index.ts`); `shared/`
never imports features. All server data goes through `@archova/api-client` and the query options in
`@archova/query`; there is no hand-written `fetch`. UI primitives come from `@archova/ui`, styled with design-token
CSS variables (`<ThemeStyle />` in the root layout).

### Sessions and CSRF

On load, `SessionBootstrap` calls `GET /v1/auth/session`; the `createWebSession()` middleware reads `csrfToken`
from that (and the sign-in/sign-up) response body and sends it as `X-CSRF-Token` on every unsafe request. The
browser adds the `Origin` header itself. A `401` from any query or mutation sends the user to `/login?next=…`.
Errors show the RFC 9457 problem `detail` and, when present, its `traceId`.
