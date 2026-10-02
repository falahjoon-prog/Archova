# Archova: security, licensing and billing

Owner: **Sam** (Security, Licensing and Billing lead). Status: draft v1, 2 Oct 2026. Documentation only; no code yet.

Other docs in this project refer to this area as `docs/security/`; this folder is that.

## Documents

| # | Doc | One-line summary |
|---|---|---|
| 01 | [Authentication and SSO](01-authentication-sso.md) | One global login per person; passwords, passkeys, MFA; SAML/OIDC SSO and SCIM for enterprise; web, mobile (PKCE, offline 7 days) and API tokens; revocation in seconds |
| 02 | [Roles and permissions](02-roles-permissions.md) | Org roles + per-project permission templates (none/read/standard/admin per tool) + company scoping + private items; one `can()` used by everything including AI |
| 03 | [Tenant isolation](03-tenant-isolation.md) | Three layers: app check, Postgres RLS, scoped files/cache/search/vectors; dedicated cells for enterprise; cross-tenant tests in CI |
| 04 | [Licensing model](04-licensing-model.md) | Procore-style: annual price by Annual Construction Volume, unlimited users, modules; plus a seat-based Team tier, single-project trial, free collaborators and free subbie orgs |
| 05 | [Subscription billing](05-subscription-billing.md) | Stripe Billing in AUD; self-serve card/BECS and invoiced annual contracts; GST tax invoices; webhooks, dunning, true-ups |
| 06 | [License enforcement](06-license-enforcement.md) | Server-side entitlements, subscription states, soft vs hard limits; never lock customers out of reading/exporting SOPA evidence |
| 07 | [Audit logging](07-audit-logging.md) | Activity log, security log and sealed evidence records; hash chain + S3 Object Lock; 7-year retention; evidence packs for adjudication |
| 08 | [Australian privacy and compliance](08-privacy-compliance-au.md) | Privacy Act/APPs, NDB scheme, 2024 reforms (AI decision transparency from Dec 2026), SOPA, WHS, GST; ISO 27001 then IRAP roadmap |
| 09 | [Security baseline](09-security-baseline.md) | OWASP ASVS L2, Essential Eight L2, encryption, secrets, mobile, AI security rules, SDLC, incident response |

## Decisions for john

1. **Pricing basis:** annual price by construction volume with unlimited users (like Procore) for Business/Enterprise, plus a per-seat Team tier for small builders. *Recommended.* (doc 04)
2. **Free subcontractor accounts:** yes, as the growth engine. *Recommended.* (doc 04 §6)
3. **Actual prices** per tier and band: placeholders until you set them. Prices must carry about A$8 per active user per month of AI cost at 70% margin, or AI is sold as a separate add-on. (doc 04 §8.1)
4. **First certification:** ISO 27001 before the first Enterprise customer. *Recommended.* (doc 08 §7)

## Settled by architecture (2 Oct 2026, `docs/architecture/cross-team-decisions.md`)

- Own identity module, swappable to WorkOS later (X5). Web uses opaque `__Host-sid` server sessions; mobile 10-minute JWTs with no org claim (X1). Org comes from the URL path (X4).
- Tenant isolation doc 03 signed off; no `BYPASSRLS` for api or worker (X11).

## Points still to settle with other leads

| With | Point | My position |
|---|---|---|
| Ben | `licensing.*` schema lacks ACV fields, price-book versioning, usage records | Add `declared_acv`, `acv_band`, `price_book_id`, `AcvSnapshot`, idempotent `UsageRecord` (doc 04 §9) |
| Ben, Ava | Unlicensed module: 402 (backend) vs 403 (architecture) | 403 `entitlement-required` (doc 06 §4) |
| Ben | Team-tier project limit: block at 110% | Hard block at 100% on Team; soft limits only for ACV/storage (doc 06 §5) |
| Ava, Ben | Audit: plan has one `activity_log` | Add a security audit log and `EvidenceRecord` sealed snapshots (doc 07 §2, §5) |
| Ari (AI) | Per-org protection for stored prompts | KMS encryption context per org; dedicated keys for dedicated cells (doc 03 §4) |
| Mobile lead | Offline window and wipe-on-revoke | 7 days default, org-configurable; encrypted local DB (doc 01 §8, doc 09 §5) |

## Needs a lawyer before launch

SOPA wording and evidence retention periods, privacy policy/DPA/terms, Australian Consumer Law terms for small business customers, e-signature validity, workplace surveillance rules for any GPS timesheet feature. Marked ⚖ in doc 08.
