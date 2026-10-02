# 09. Security baseline

Owner: Sam. Status: draft v1, 2 Oct 2026. Shared with the infrastructure, backend, frontend and mobile leads; they own implementation, this doc sets the bar.
Related: all other docs in this folder.

## 1. Targets

- Application: **OWASP ASVS 4.x Level 2**, and OWASP Mobile ASVS L1 (+ selected L2 for offline data) for the apps.
- Corporate/ops: **ASD Essential Eight** maturity level 2.
- Availability: 99.9% monthly for the API (Business), 99.95% (Enterprise). Recovery: RPO 15 minutes, RTO 4 hours (placeholders for the infrastructure lead to confirm).

## 2. Data protection

- TLS 1.2+ everywhere (TLS 1.3 preferred), HSTS with preload on our domains.
- Encryption at rest: RDS, S3, EBS, backups and Redis all with AWS KMS keys. Siloed tenants get their own key (doc 03).
- Application-level encryption for a few fields: MFA secrets, SSO/SCIM secrets, integration OAuth tokens (Xero/MYOB), webhook signing secrets. Envelope encryption via KMS.
- Backups: automated, encrypted, cross-region copy to Melbourne (keeps data in AU), restore tested quarterly.

## 3. Secrets and keys

- AWS Secrets Manager / KMS only. No secrets in code, env files in the repo, CI logs or mobile app bundles.
- Secret scanning on every push (and GitHub push protection). Our token formats are prefixed so scanners can recognise them.
- Rotation: DB credentials 90 days (automatic), JWT signing keys 90 days, third-party API keys yearly or on staff exit.

## 4. Application security

- Input validation with shared schemas (zod) at every API boundary; output encoding by default (React), strict Content Security Policy with nonces, no inline scripts.
- SQL only through the ORM/query builder with parameters; raw SQL needs review.
- File uploads: type allow-list by magic bytes, size limits, malware scan, served from a separate domain with `Content-Disposition: attachment` for non-previewable types, no SVG/HTML rendering in our origin.
- SSRF protection for any feature fetching URLs (webhooks, link previews, imports): deny private IP ranges and metadata endpoints, egress proxy.
- Outbound webhooks signed (HMAC-SHA256 with timestamp) so customers can verify them.
- Rate limiting at the edge (AWS WAF managed rules + bot control) and per-org/per-user in the API.
- Security headers: CSP, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, frame-ancestors none (except where we embed ourselves).

## 5. Mobile apps

- Auth per doc 01 §8 (PKCE, Keychain/Keystore, refresh rotation).
- Offline database encrypted (SQLCipher or platform equivalent), key in Keychain/Keystore; wiped on logout, revocation, or org removal.
- No sensitive data in app logs, screenshots of sensitive screens blurred in app switcher (claims, incidents).
- Enterprise: support MDM app config (managed sign-in domain, disable offline) for builders that manage phones.
- Certificate pinning: not by default (operational risk outweighs benefit for us); revisit for Enterprise if asked.

## 6. AI features

The user asked for AI throughout the product. Security rules for it:

1. **Acts as the user.** Retrieval and tool calls go through `can()` (doc 02). The vector index is tenant- and ACL-filtered before ranking (doc 03 §5).
2. **Prompt injection is expected.** Uploaded drawings, specs and emails are untrusted input. The model's instructions can't be overridden into reaching other projects/tenants, because it never has credentials beyond the user's request context. Tools that change data are allow-listed per feature.
3. **Human confirms anything with legal or financial effect.** AI may draft an RFI or summarise a variation; a person issues it. Per Ari's rules (`docs/ai/04` §7), AI never writes payment claim/schedule wording or computes SOPA dates. Recorded as `ai_assisted` in the audit log (doc 07).
4. **No training on customer data**, contractually (with the model provider) and in our privacy policy. Model provider configured for zero/limited data retention.
5. **Data residency:** prefer models served from an Australian AWS region (e.g. via Amazon Bedrock in Sydney/Melbourne) where available; otherwise disclose as cross-border (doc 08 APP 8).
6. **Cost controls:** AI credits (doc 04 §8), per-request token caps, per-org rate limits.
7. Prompt/response bodies kept 30 days by default (org can set 0–90, per Ari's `docs/ai/04` §5), access restricted, then deleted; request metadata without bodies kept 7 years with the audit log.
8. Using a non-AU model endpoint (e.g. first-party API for newer features) is opt-in per org with a clear residency notice.

## 7. Secure development lifecycle

- Threat model (STRIDE, lightweight) for each module before build, starting with: auth, permissions, files, payment claims, public API, AI.
- Code review required on every PR; security-sensitive paths (auth, permissions, billing, tenant context, crypto) need a CODEOWNERS review from security.
- CI: SAST (Semgrep/CodeQL), dependency scanning (Dependabot/Renovate + `npm audit`), container scanning, IaC scanning (Checkov/tfsec), secret scanning, the cross-tenant test suite (doc 03 §7).
- Dependencies pinned with lockfiles; new dependencies reviewed for maintenance and licence.
- Annual external penetration test (web, API, mobile) and before major launches; vulnerability disclosure policy at launch, paid bug bounty once mature.
- Patch SLAs: critical 48h, high 7 days, medium 30 days.

## 8. Operations and incident response

- Infrastructure as code only; no console changes in production. Production access via SSO + MFA, just-in-time, time-boxed, logged (AWS IAM Identity Center).
- Centralised logs and alerts (CloudTrail, GuardDuty, Security Hub, app security events from doc 07 §9).
- Incident response runbook with severity levels, on-call rotation, customer comms templates, and the NDB assessment steps in doc 08 §5. Tabletop exercise twice a year.
- Staff: background checks for anyone with production access, security training at onboarding and yearly, offboarding revokes access same day.

## 9. Scale considerations for security controls (100k users)

- Stateless API nodes; sessions/permissions/entitlements in Redis (cluster mode, Multi-AZ). Losing Redis degrades to DB lookups, never to "allow".
- WAF and rate limits absorb credential stuffing at the edge.
- Audit pipeline is asynchronous via outbox (doc 07 §8), so security logging scales independently.
- Every control here **fails closed**: missing tenant context, missing permission, missing entitlement or unreachable policy store means deny, with a clear error.
