# API architecture

**Owner:** Ava (style and contract rules), Ben (endpoints), Sam (auth/security detail) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Style

- **REST over HTTPS with JSON**, resource-oriented, **contract-first**: the OpenAPI 3.1 spec in `packages/contracts/openapi/` is the source of truth. Server validation, TypeScript types and the web/mobile `api-client` are generated from it ([ADR-0002](adr/0002-rest-openapi-contract-first.md)).
- **One API for everyone**: web, mobile, internal tools and third parties call the same `/v1` endpoints. Internal-only endpoints are tagged `x-internal: true` and excluded from the public docs, not built separately.
- **Real-time** (web: `wss://app.<domain>/realtime` with cookie + `Origin` check; mobile: `wss://api.<domain>/realtime` with token in the first message; see ADR-0004) (notifications, "someone is editing", live comment threads) over **WebSocket** via `apps/realtime`; messages are hints ("rfi rfi_123 changed, version 8") and clients refetch over REST. No business writes over WebSocket.
- **Bulk and sync** endpoints for mobile (see §7).

Why not GraphQL: the public API and webhooks are easier to version, cache, rate-limit and document as REST; field-level over-fetching is handled with `fields=` and `include=`. Why not tRPC: mobile and third parties need a language-neutral contract.

## 2. URL design

```
https://api.<domain>/v1/orgs/{orgId}/projects/{projectId}/rfis      # mobile, integrations (bearer)
https://app.<domain>/v1/orgs/{orgId}/projects/{projectId}/rfis      # same API, browser (cookie, same-origin)
https://api.<domain>/v1/orgs/{orgId}/projects/{projectId}/rfis/{rfiId}
https://api.<domain>/v1/orgs/{orgId}/projects/{projectId}/rfis/{rfiId}/responses
https://api.<domain>/v1/orgs/{orgId}/companies
https://api.<domain>/v1/me                      # current user, memberships across orgs
```

- The org is always explicit in the path. The tenant plugin checks the caller is a member of that org before anything else runs.
- Project-scoped resources nest under the project; IDs are globally unique, so `GET /v1/orgs/{orgId}/rfis/{rfiId}` shortcuts are allowed for deep links.
- Plural nouns, kebab-case path segments (`/payment-claims`), camelCase JSON fields.
- Actions that aren't CRUD use a sub-resource verb: `POST .../rfis/{id}/close`, `POST .../payment-claims/{id}/submit`.

## 3. Standard behaviours (every endpoint)

| Concern | Rule |
|---|---|
| IDs | Prefixed UUIDv7 strings, e.g. `rfi_01J9Z...` ([conventions](conventions.md#ids)) |
| Pagination | Cursor-based: `?limit=50&cursor=...` → `{ data: [...], nextCursor }`. Max limit 200. No offset pagination on large tables. |
| Filtering / sorting | `?filter[status]=open&filter[assigneeId]=usr_...&sort=-dueDate` |
| Sparse fields / expansion | `?fields=id,number,subject&include=assignee,drawing` |
| Concurrency | Responses carry `ETag` (row `version`); `PATCH`/`PUT` require `If-Match`, else `428`; mismatch → `412` |
| Idempotency | All `POST` accept `Idempotency-Key`; stored 24h per org. Mandatory for mobile and integrations |
| Errors | RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, `code`, `errors[]` (field errors), `traceId` |
| Time | ISO 8601 UTC in payloads; project timezone exposed on project resource for display and business-day calcs |
| Money | `{ "amount": "12345.67", "currency": "AUD" }` as decimal string; stored as integer cents / numeric |
| Rate limiting | Per token and per org, sliding window in Redis; `RateLimit-*` headers; `429` with `Retry-After` |
| Versioning | Major version in path (`/v1`). Additive changes don't bump. Breaking changes → `/v2` with ≥12 months overlap for public consumers. Event and webhook payloads versioned in their type name |
| Deprecation | `Deprecation` and `Sunset` headers; listed in changelog |
| Files | Never streamed through the API. `POST /uploads` returns a presigned S3 URL (multipart for >100 MB); client uploads direct; then creates the domain object referencing `uploadId`. Downloads via short-lived signed CloudFront URLs |

## 4. Authentication and authorisation

Sam owns the detail in `docs/security-licensing/`. Architectural shape:

- **Identity:** our own `identity` module ([ADR-0005](adr/0005-identity-in-house-module.md)).
- **Web:** opaque server-side session in a `__Host-sid` cookie (Redis + Postgres), no JWT in the browser. Browser calls the API **same-origin** at `app.<domain>/v1/*`; CSRF via `SameSite=Lax`, `Origin` check and a double-submit token ([ADR-0004](adr/0004-web-session-and-api-routing.md)).
- **Mobile:** OAuth 2.1 + PKCE; 10-minute ES256 access JWT (no roles, no org claim) and a rotating refresh token in Keychain/Keystore. Calls `api.<domain>/v1/*` with `Authorization: Bearer`.
- Both resolve to the same principal in the API auth plugin; the org always comes from the URL path.
- **SSO:** SAML 2.0 and OIDC per org (enterprise plan); SCIM provisioning later.
- **MFA:** TOTP and passkeys (WebAuthn).
- **Public API / integrations:** OAuth 2.0 authorisation code + PKCE for apps acting as a user; client credentials for org-level service accounts. Scopes map to module permissions (`rfis:read`, `rfis:write`).
- **Authorisation** happens in two layers: (1) org membership + entitlement at the plugin layer; (2) `access.can(principal, action, resource)` in the use case, using role + project membership + permission template + company (subcontractors see only what they're party to). Postgres RLS is the backstop for tenant isolation, not for fine-grained permissions.

## 5. Public API and developer platform (phase 2)

- Same endpoints, published in `apps/docs-site` from the OpenAPI spec, with generated SDKs (TypeScript first, later Python, C#).
- Sandbox orgs for developers.
- Per-app rate limits and usage metering through `billing` (API access can be a licensed feature).

## 6. Webhooks (phase 2)

- Orgs subscribe to event types (e.g. `rfis.rfi.created.v1`). The `integrations` module fans out domain events to subscriptions.
- Delivery: HTTPS POST, JSON body = event envelope, headers `Webhook-Id`, `Webhook-Timestamp`, `Webhook-Signature` (HMAC-SHA256, Standard Webhooks spec).
- At-least-once, exponential retry for up to 72h, then auto-disable with email to org admin. Delivery log visible in the UI.

## 7. Mobile sync endpoints

Offline-first mobile needs more than CRUD (detail in [clients.md](clients.md#3-offline-sync)):

- `GET /v1/orgs/{orgId}/sync/pull?scopes=project:{id}:diary,defects&since={checkpoint}` → changed and deleted records since a server checkpoint, paginated, plus `revokedScopes` when the user has lost access so the device purges that data.
- `POST /v1/orgs/{orgId}/sync/push` → batch of client mutations, each with `Idempotency-Key`, base `version` and client timestamp; per-item result (applied / conflict with server copy / rejected).
- Pull is driven by a per-org change feed (`change_feed` table, sequence per org) so it scales without scanning feature tables.

## 8. Web app access pattern

The Next.js app calls the API from **server components and route handlers** (server-to-server on the internal address, forwarding the user's `__Host-sid` cookie) and from the browser via TanStack Query for interactive screens, same-origin at `app.<domain>/v1/*` (routed by CloudFront/ALB straight to `apps/api`, not through Next.js). Next.js does not talk to the database. This keeps the API the single enforcement point.
