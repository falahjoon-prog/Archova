# 01. Authentication and SSO

Owner: Sam (Security, Licensing and Billing). Status: draft v1, 2 Oct 2026.
Related: [02 roles and permissions](02-roles-permissions.md), [03 tenant isolation](03-tenant-isolation.md), [07 audit logging](07-audit-logging.md).

## 1. Goals

- One login per person across every builder they work with. A subcontractor's site manager may be on projects for six different builders; they get one account, not six.
- Support three client types from day one: web app, iOS/Android apps (offline-capable), and the public API / integrations.
- Enterprise builders can force their staff through their own identity provider (Microsoft Entra ID, Okta, Google Workspace) and provision/deprovision users automatically.
- Scale target: 100,000+ users, with login and token refresh never becoming a bottleneck.
- All identity data stays in AWS Sydney (ap-southeast-2) for data residency.

## 2. Identity model

```
User            (id, email, email_verified_at, name, phone, status: active|locked|deactivated, created_at)
Credential      (id, user_id, type: password|passkey|totp|sso, secret_ref, created_at, last_used_at)
Organization    (id, name, abn, ...)
Membership      (org_id, user_id, role_template_id, status: invited|active|suspended, source: manual|scim|sso_jit)
VerifiedDomain  (org_id, domain, verified_at, method: dns_txt)
SsoConnection   (id, org_id, protocol: saml|oidc, idp_metadata, enforce: bool, jit_provisioning: bool, default_role_template_id)
ScimDirectory   (id, org_id, token_hash, last_sync_at)
Session         (id, user_id, client: web|ios|android, device_id, ip, created_at, last_seen_at, expires_at, revoked_at)
RefreshToken    (id, session_id, token_hash, family_id, used_at, expires_at)
ApiClient       (id, org_id, name, type: oauth_app|service_account, scopes[], secret_hash, created_by)
PersonalAccessToken (id, user_id, org_id, scopes[], token_hash, expires_at, last_used_at)
```

Key rule: **User is global; Membership is per organisation.** An organisation never "owns" a user record. It owns the membership. Deactivating someone in Builder A removes access to Builder A's data only.

Exception: when an org has verified a domain (e.g. `@acmebuilders.com.au`) and enforces SSO, users with that email domain are *managed users* of that org. Their authentication policy (SSO, MFA) is set by that org, everywhere they log in.

## 3. Build vs buy (recommendation)

| Option | Data in AU | SSO/SCIM | Cost at 100k users | Lock-in |
|---|---|---|---|---|
| Clerk / Auth0 | Mostly US-hosted, AU region limited | Yes, paid tiers | High (per MAU) | High |
| AWS Cognito (Sydney) | Yes | SAML/OIDC yes, SCIM no | Low | Medium |
| **Own identity service on Postgres + standard libraries** | Yes | Yes, via self-hosted SAML/OIDC library and our own SCIM endpoint | Lowest | Low |

**Decided (Ava's cross-team decision X5, ADR-0005):** identity is our own `identity` module inside the backend, built on well-maintained libraries rather than hand-rolled crypto (Auth.js for flows, `@simplewebauthn` for passkeys, `otplib` for TOTP, self-hosted SAML Jackson for enterprise SAML/OIDC, our own SCIM endpoint). All identity data stays in Sydney and there's no per-user pricing at 100k users. It sits behind an interface that can be swapped to a managed provider such as WorkOS later; if that happens, the provider is added to the sub-processor list (doc 08, APP 8).

## 4. Login methods

| Method | Who | Notes |
|---|---|---|
| Email + password | Everyone (default) | Argon2id (memory ≥ 19 MiB, t=2). Minimum 10 chars, checked against breached-password list (k-anonymity range query, HIBP-style). No forced periodic rotation (NIST 800-63B). |
| Passkeys (WebAuthn) | Everyone, encouraged | Phishing-resistant. Counts as MFA. Primary push for site staff on phones (Face ID / fingerprint). |
| Magic link | Invited collaborators on first login only | Single-use, 15-minute expiry, then prompted to set password or passkey. |
| TOTP authenticator app | MFA factor | RFC 6238. 10 single-use recovery codes, hashed. |
| SMS OTP | MFA fallback only, off by default | Weak (SIM swap). Orgs can disable it. |
| SAML 2.0 / OIDC SSO | Enterprise orgs | See §6. |
| Google / Microsoft social login | Optional convenience | Only links to an existing account after email verification; never auto-merges unverified emails. |

## 5. MFA policy

- Required for: org owners and admins, anyone with Financials Admin or billing permissions, all internal support staff (always hardware key or passkey).
- Org admins can require MFA for all members of their org. The requirement applies **when accessing that org's projects**, even for external collaborators. (Builder sets the bar for its own data.)
- Step-up authentication (re-auth within last 10 minutes) before: changing payment details, issuing/approving a payment schedule, exporting all project data, changing SSO settings, creating API tokens, deleting a project.

## 6. Enterprise SSO (SAML / OIDC)

Flow:
1. Org admin verifies their email domain via DNS TXT record.
2. Admin configures SSO connection (upload IdP metadata or OIDC discovery URL). We show our ACS URL, entity ID and SP metadata.
3. Test login by admin before enforcement can be switched on.
4. When `enforce = true`: password and social login are disabled for users on that domain; login page detects the domain from the email entered and redirects to the IdP.
5. Just-in-time provisioning (optional): first SSO login creates the membership with the default role template.

Rules:
- Validate SAML signatures on the assertion (not just the response), check audience, recipient, `NotOnOrAfter`, and replay (store assertion IDs until expiry). Reject unsigned assertions and XML with DTDs.
- IdP-initiated SAML off by default (replay/CSRF risk); allowed per connection if the customer needs it.
- Break-glass: each org keeps at least one owner who can log in with password + passkey if their IdP is down. Logged loudly.
- Group-to-role mapping: IdP groups can map to role templates (e.g. `Procore-PM` group → Project Manager template). Mapping lives on the SsoConnection.

## 7. SCIM 2.0 provisioning

- Endpoint per org: `/scim/v2/{org}/Users` and `/Groups`, bearer token (shown once, stored hashed).
- Create → membership invited/active. Deactivate (`active: false`) → membership suspended **and all sessions for that org revoked within 60 seconds** (see §9 revocation).
- Groups → role template assignments.
- Tested against Entra ID and Okta, the two most common in AU enterprise builders.

## 8. Sessions and tokens

### Web
- **Decided (X1, ADR-0004):** server-side sessions. Opaque session ID in a cookie: `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Lax`. No tokens in the browser.
- The browser calls the API same-origin at `app.<domain>/v1/*` with cookie auth only; `api.<domain>` is bearer-only for mobile and the public API, with no credentialed CORS (X2).
- Session store: Redis (hot) backed by Postgres `Session` table (durable, for "your devices" and revoking).
- Realtime sockets: cookie on upgrade plus strict `Origin` check; revocation closes sockets within seconds (X3).
- Idle timeout 12 hours default, absolute 30 days. Org admins can shorten both.
- CSRF: SameSite plus a double-submit token on state-changing requests; server actions validate `Origin`.

### Mobile (iOS / Android)
- OAuth 2.1 authorization code flow with PKCE via system browser (ASWebAuthenticationSession / Custom Tabs), so SSO works the same as web.
- Access token: signed JWT, 10-minute lifetime, contains `sub`, `sid`, `client`, and nothing sensitive. **No `org` claim:** the org always comes from the URL path and is checked against membership (X4). Permissions are **not** baked into the token (they change too often); the API resolves them per request.
- Refresh token: opaque, rotated on every use, stored in iOS Keychain / Android Keystore. Reuse of an already-used refresh token revokes the whole token family (theft detection).
- Offline: the app may keep working offline for up to 7 days without a refresh (configurable by org, minimum 1 day). Locally cached data is encrypted with a key held in Keychain/Keystore. On revocation, the next sync wipes local data for that org; when a user loses access to a project or module, the sync pull's `revokedScopes` field tells the device to purge that data (X14).
- Biometric unlock of the app is a local gate only, not an auth factor to our server.

### Public API and integrations
- OAuth 2.0 authorization code for third-party apps acting for a user (marketplace apps).
- Client credentials for service accounts (org-owned integrations, e.g. Xero sync).
- Personal access tokens for power users: scoped, expiring (max 1 year), prefixed (`pk_live_...`) so secret scanners catch leaks.
- All tokens hashed at rest (SHA-256), shown once.
- Scopes are coarse (e.g. `projects:read`, `rfis:write`, `financials:read`); the user's or service account's permissions still apply on top. A token can never do more than its owner.

### JWT signing
- Asymmetric (ES256), keys in AWS KMS, rotated every 90 days, published via JWKS with overlap.

## 9. Revocation

- Every session and token links to `user_id` and, for SSO, the org. Revocation events: logout, password change (revokes all other sessions), admin removes member, SCIM deactivate, user locked, suspected compromise.
- Revocation writes to Postgres and publishes to a Redis channel. Access-token JWTs are short (10 min), and the API checks a Redis revocation set keyed by `sid` on each request, so revocation takes effect in seconds, not minutes.

## 10. Abuse protection

- Login rate limits: per account (5 failures → exponential backoff, 20 → temporary lock + email), per IP, and per IP range. Use a sliding window in Redis.
- Credential-stuffing signals: many accounts from one IP, impossible travel. Trigger CAPTCHA (privacy-friendly, e.g. Turnstile) rather than hard block.
- Uniform error messages ("email or password incorrect") and constant-time comparison.
- Account recovery: email link only, invalidates all sessions, notifies the user. Recovery cannot bypass SSO enforcement.
- New-device and new-location login emails.

## 11. Internal staff access (our support team)

- Separate admin console on a separate domain, SSO into our own IdP with hardware-key MFA.
- Support cannot read customer project data by default. "Access as user" (impersonation) needs: customer org setting allowing support access, a ticket reference, time box (max 1 hour), read-only by default. Every action is recorded in the customer-visible audit log, flagged as support access.

## 12. Scale notes (100k+ users)

- Password hashing is CPU-heavy by design. Run login on autoscaled API nodes; at a peak of ~50 logins/sec (morning site start, 6–7am AEST), Argon2id at ~50ms each is ~3 CPU cores. Fine.
- Session lookups: Redis, O(1). Token verification: local JWKS, no network call.
- Permission resolution is the real hot path, see doc 02 for caching.
