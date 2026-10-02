# ADR-0004: Web sessions, API origins and realtime authentication

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Ava (architecture), Sam (security). Input from Ben and Felix.
- **Affects:** backend (`docs/backend/02-multi-tenancy-auth-licensing.md`), security (`docs/security-licensing/01-authentication-sso.md`), web (`docs/frontend/04-shared-api-clients.md`), mobile, devops

## Context
Ben's backend doc described the web session as a 15-minute access JWT in an httpOnly cookie. Sam's security doc described an opaque server-side session id in a `__Host-sid` cookie. Felix proposed serving the API on the web app's own origin. The realtime socket and the edge routing depend on which session format wins.

## Decision

### 1. Web: opaque server-side session (Sam's design)
- Cookie `__Host-sid`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. Value is an opaque random id (≥128 bits). The browser never holds a JWT or refresh token.
- Session store: Redis (hot lookup, O(1)) backed by the Postgres `Session` table (durable; device list and revocation). Idle 12 h, absolute 30 days, org-configurable shorter.
- Revocation is instant: delete from Redis + publish on the revocation channel.

### 2. Mobile and integrations: bearer tokens
- Mobile: OAuth 2.1 code + PKCE; **10-minute** ES256 access JWT (`sub`, `sid`, `client`; no roles, **no org claim**) plus opaque rotating refresh token in Keychain/Keystore. Supersedes the 15-minute figure in Ben's doc.
- Public API: OAuth apps, service accounts and personal access tokens as in Sam's doc.
- The API checks the `sid` against the Redis revocation set on every bearer request.

### 3. One API service, two origins
| Origin | Path | Who | Credentials accepted |
|---|---|---|---|
| `app.<domain>` | `/v1/*` → `apps/api` (CloudFront/ALB path rule); `/realtime` → `apps/realtime`; everything else → `apps/web` | Browser (web app) | `__Host-sid` cookie only |
| `api.<domain>` | `/v1/*`, `/realtime` | Mobile, public API, integrations | `Authorization: Bearer` only; cookies ignored |

- Browser calls are **same-origin**: no CORS, first-party cookie, no API traffic proxied through Next.js servers.
- `api.<domain>` sends no credentialed CORS headers, so a browser page can't use it with cookies.
- Next.js server components call the API server-to-server on the internal service address, forwarding the user's `__Host-sid` cookie; the API validates it exactly as for a browser call.

### 4. API authentication plugin
Both credential types resolve to the same `Principal { userId, sessionId, client, authMethod }`. The org comes from the URL path and is checked against membership (ADR-0003). Downstream code never knows which credential was used, except step-up checks (`authMethod`, `authTime`) for sensitive actions such as submitting a payment claim.

### 5. CSRF (cookie requests only)
`SameSite=Lax` plus, on every unsafe method: `Origin` must equal `https://app.<domain>`, and a double-submit token (`__Host-csrf` cookie echoed in an `X-CSRF-Token` header, added by the web `auth-client` adapter). Bearer requests are exempt.

### 6. Realtime (WebSocket)
- **Web:** connects to `wss://app.<domain>/realtime`. The upgrade request carries `__Host-sid`; `apps/realtime` validates it against Redis and **rejects any `Origin` other than `https://app.<domain>`** (prevents cross-site WebSocket hijacking).
- **Mobile:** connects to `wss://api.<domain>/realtime` and sends the access token in the first message (never in the URL, which ends up in logs). The server closes the socket at token expiry unless the client sends a refreshed token first.
- `apps/realtime` subscribes to the revocation channel and closes affected sockets within seconds.
- Channel subscriptions (`org:{id}`, `project:{id}`, `user:{id}`) are authorised on subscribe with the same membership and permission checks as the API.

## Alternatives considered
- **JWT in a cookie for web (Ben):** avoids a session lookup, but revocation then depends on a denylist anyway, refresh handling in the browser is more complex, and token size grows. A Redis lookup per request is cheap at our scale (~2,500 req/s peak).
- **Separate `api.<domain>` for the browser with CORS:** extra preflights on every call and either a third-party cookie or a token exposed to JavaScript. Weaker and slower.
- **Proxy all browser API calls through Next.js:** doubles hops and makes the web tier scale with API traffic.

## Consequences
- Ben updates backend doc 02 to this ADR (web row of the client table; drop the `org` claim; 10-minute access token).
- Owen configures the CloudFront/ALB path rules for `app.<domain>` and the separate `api.<domain>` distribution.
- Felix's `auth-client` web adapter adds the CSRF header; Mia's mobile adapter handles token refresh and the realtime first-message auth.
- Sam's doc 01 §8 stands as written; it is now the reference for sessions.
