# 04 · Shared API clients (web + mobile)

Owner: Felix (with Mia for mobile, Ben for the API). Status: draft v1, 2 Oct 2026.

Builds on Ava's decisions D3/D4 ([overview](../architecture/overview.md), [api.md](../architecture/api.md)): a separate `apps/api`, REST + JSON, contract-first OpenAPI 3.1, generated clients. Goal: one contract and one client, used unchanged by the web app and the Expo app, so a renamed field breaks both builds on the same commit.

## 1. What is shared, and what isn't

| Package | Web | Mobile | Notes |
|---|---|---|---|
| `contracts` (OpenAPI, types, zod) | yes | yes | Source of truth. Ben owns the spec. |
| `api-client` | yes | yes | Generated + thin wrapper (below). |
| `auth-client` | yes | yes | Platform adapter differs (cookie vs Keychain). |
| `domain` | yes | yes | Ids, money, statuses, validators, status transitions, permission checks (UI gating only; API enforces). Backend imports it too. |
| `query` | yes | online-only reads | Key factories + `queryOptions()`. |
| `routes` | yes | yes | Deep links. |
| `sync-core` | no (for now) | yes | Mia's offline engine ([mobile/02-offline-sync.md](../mobile/02-offline-sync.md)). |
| `markup` | yes | yes | Drawing markup schema/geometry, so markups match everywhere. Visibility is `private \| company \| project`. |
| UI components | `ui` | `ui-native` | Same props API, different renderers (Uma). |

Data hooks are **not** shared: web reads through TanStack Query, while mobile reads from its local SQLite store (Mia's design). What's shared underneath is the client, the keys, the schemas and the rules.

None of the shared packages may import `react-dom`, `next/*` or `react-native`; a lint rule in CI enforces it so a web-only import can't break the mobile build.

## 2. The client

Codegen (`pnpm gen`, per Ava's repo-structure) produces types and per-operation functions from the spec. A small hand-written `createApiClient(config)` wraps `fetch` and handles, once, for every caller:

- base URL and `/v1` prefix; client name and version headers (`X-Client: web@1.42.0`) for support and compatibility checks;
- auth through a pluggable `auth-client` adapter;
- `traceparent` / request id so a browser error joins to the API trace;
- RFC 9457 problem responses mapped to a typed error union (doc 02 §8);
- `ETag` captured on reads and sent as `If-Match` on writes;
- `Idempotency-Key` generated for every POST (required by the API for mobile and integrations; we use it on web too so a double-click can't create two claims);
- retry with jitter only for idempotent requests on network errors, 429 and 503, honouring `Retry-After`;
- cursor pagination helpers that yield `{ data, nextCursor }` pages;
- `AbortSignal` support so cancelled searches stop on the wire.

Response validation with the generated zod schemas runs in development and tests, and on a small sample in production, so contract drift shows up in error tracking without paying the cost on every request.

## 3. Platform adapters

| Concern | Web | Mobile |
|---|---|---|
| Who calls the API | Browser and Next.js server components, at `app.<domain>/v1/*` | App, at `api.<domain>/v1/*` |
| Auth | `__Host-sid` cookie only; no tokens in the browser. Server components forward the cookie on server-side calls | bearer access token (10 min) in memory, refresh token in Keychain/Keystore (`auth-client`) |
| CSRF | `Origin` check on the server plus a double-submit `X-CSRF-Token` header the client adds to every state-changing request | not applicable (bearer) |
| Realtime | `app.<domain>/realtime`, cookie on upgrade | token in the first message |
| Cache at rest | memory only; nothing sensitive persisted in the browser | encrypted SQLite (Mia) |
| Network status | `navigator.onLine` + failed-request signal | NetInfo |
| Uploads | presigned S3 PUT, multipart and resumable over 50 MB, straight from the browser | background upload tasks (Mia's doc 03) |

**Same-origin routing (decided, [ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md)):** CloudFront/ALB sends `app.<domain>/v1/*` to `apps/api` and `app.<domain>/realtime` to `apps/realtime`. The session cookie stays first-party, there are no CORS preflights, and API traffic doesn't pass through Next.js. `api.<domain>` serves mobile and the public API with bearer tokens only and no credentialed CORS, so the browser never calls it.

The web adapter in `auth-client` reads the CSRF token from its cookie and sets `X-CSRF-Token` on every POST, PUT, PATCH and DELETE. On a `403` CSRF failure it refreshes the token once and retries; a `401` sends the user to sign-in with `next=` set.

## 4. Offline

The web app is online-only in phases 0 to 3, but degrades gracefully: failed writes stay in the form with a retry, uploads resume, and a banner shows when the connection drops. If web offline is wanted later, it adopts `sync-core` rather than inventing a second engine; nothing in the web structure blocks that.

## 5. Versioning and compatibility

- Additive changes within `/v1` don't break either app. Removals need Ben's deprecation window.
- Web always deploys alongside the API from the same commit, so it is never behind. Mobile apps in the field lag; the API returns `426 Upgrade Required` for versions it no longer supports and both apps show a standard "please update" screen.
- Long-lived web tabs: if the API reports a newer minimum web version, the app shows a "new version available, reload" bar rather than failing calls.

## 6. Public API

The same spec, filtered to non-`x-internal` operations, generates the public TypeScript SDK published from `apps/docs-site` (Ava's api.md). We don't hand-maintain a third client.
