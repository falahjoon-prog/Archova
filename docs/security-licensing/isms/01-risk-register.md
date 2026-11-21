# Risk register (v1, 21 Nov 2026)

Owner: Sam (Security). Reviewed by: Grace (Compliance) for R-17 to R-21. Next review: Feb 2027 or when a module/supplier is added.

## Method

Likelihood (L) 1 rare, 2 unlikely, 3 possible, 4 likely, 5 almost certain, over the next 12 months. Impact (I) 1 minor, 2 moderate (one tenant inconvenienced), 3 serious (one tenant's data exposed or SOPA deadline missed), 4 major (several tenants, regulator notice), 5 severe (platform-wide breach, loss of trust or licence to operate). Score = L x I. **Inherent** assumes no treatment; **Residual** is after the controls marked Implemented today (not designed ones). 1-6 low, 8-12 medium, 15-25 high. High residual risks need a dated treatment plan and John's acceptance; medium ones are accepted by Sam and reported; low ones are monitored.

Scores are the author's judgement from the code and docs and are for Sam and Grace to challenge. Status of a control follows the vocabulary in the README.

## Register

| ID | Risk | Asset / area | L | I | Inherent | Existing controls (status) | Residual | Treatment (owner, target) | Annex A |
|---|---|---|---|---|---|---|---|---|---|
| R-01 | Cross-tenant data exposure through a code or query bug | Tenant data in Postgres, files | 3 | 5 | 15 | RLS on every tenant table via `kernel.enable_tenant_rls`; all use cases in `withTenantTx`; no BYPASSRLS (X11) (Implemented); cross-tenant tests (Implemented) | 6 | Add synthetic-tenant canary in prod (Designed, infra/05); pen test covers tenant isolation (Ben/Sam, with R-10) | 5.15, 8.3, 8.26 |
| R-02 | No production environment: controls cannot be evidenced, residency cannot be asserted | All | 5 | 4 | 20 | AWS Terraform validated, not applied; Linode option coded, not run (Designed) | 20 | Decide and apply production (John decides, Jeff builds). **Blocks audit** | 5.23, 7.x, 8.9 |
| R-03 | Pilot runs on a PC behind a Cloudflare quick tunnel: data outside AU transit, host uptime and patching unmanaged, demo data could be mistaken for real | Pilot demo | 4 | 3 | 12 | Sample data only; owner console not public (Process, partly) | 9 | Customer data must not enter the tunnel demo; remove once prod is live (John/Jeff) | 5.23, 7.9, 8.20 |
| R-04 | Security events not recorded: no audit trail of logins, MFA, role changes, exports, token creation | `modules/identity`, reporting | 5 | 4 | 20 | Business audit log from `shared.outbox` (Partial); `support_events`/`staff_audit` append-only (Implemented for support sessions and legal holds only) | 16 | Build security audit log per doc 07 with hash chain and S3 anchor (Ben/Sam, P0 #2) | 8.15, 8.17, 5.28 |
| R-05 | No infrastructure/admin logging or threat detection (CloudTrail, GuardDuty, Config, Security Hub, log archive have no Terraform) | AWS org | 4 | 4 | 16 | SCPs deny disabling them (Designed, scps.tf) | 16 | Control Tower and org logging in Terraform (Jeff, P0 #3) | 8.15, 8.16, 5.7 |
| R-06 | Account takeover of a product user (credential stuffing, phishing) | Identity module | 4 | 3 | 12 | Password breach check, TOTP, passkeys, `__Host-sid` sessions, API tokens (Implemented); MFA not mandatory for all roles (confirm) | 6 | Enforce MFA for admin roles; security alerts on anomalies (depends on R-04) | 8.5, 5.17 |
| R-07 | Staff or developer account compromise (GitHub, cloud, email) | Source, CI, infra | 3 | 5 | 15 | Staff SSO/MFA via IAM Identity Center and a FIDO2 IdP are Designed only; GitHub MFA enforcement unverified | 15 | Enforce MFA on GitHub, Google Workspace, AWS; keep evidence (Sam/John, P1 #7) | 5.17, 8.2, 6.7 |
| R-08 | Excess or misused staff access to customer data | Backoffice, support | 2 | 5 | 10 | Time-boxed grants (72 h), sessions (60 min), append-only `support_events` and `staff_audit` with immutability triggers (Implemented); other `org-actions` not in `staff_audit` (Partial) | 6 | Extend `staff_audit` to all console actions; quarterly access review with signed record (Sam) | 5.15, 5.18, 8.2 |
| R-09 | Secrets leaked in source or logs | Repo, CI, workers | 3 | 4 | 12 | gitleaks in CI; pino redaction rules (Implemented); Secrets Manager paths (Designed) | 6 | Confirm gitleaks blocks merge; add log-redaction test (Quinn) | 8.4, 5.17, 8.12 |
| R-10 | Exploitable web/API/mobile vulnerability never found: no external pen test | Whole product | 3 | 5 | 15 | ZAP DAST, CodeQL (only if enabled), Trivy, pnpm audit (Implemented/Partial) | 12 | Commission accredited pen test at phase end (John pays; needs commissioning); enable CodeQL (John, GitHub Advanced Security) | 8.8, 8.29 |
| R-11 | Vulnerable dependency or supply-chain compromise | `pnpm` monorepo, images | 3 | 4 | 12 | `pnpm audit` high+, dependabot.yml, Trivy, lockfile (Implemented) | 6 | Record patch SLA performance (critical 48 h, high 7 d) (Sam) | 8.8, 5.21, 8.19 |
| R-12 | Unreviewed change reaches `main` (CI outage merges in Nov 2026, single-owner CODEOWNERS) | Change management | 4 | 3 | 12 | PR-only merges, conventional commits; CI gates (Implemented); CI-down exception allowed once (Partial, evidence of lapses exists) | 9 | Stop merging while CI down (P4); add second reviewer to CODEOWNERS when Sam's reviewers have accounts; log exceptions | 8.32, 8.25, 8.29 |
| R-13 | Single-person key risk: John and Jeff hold mobile signing keys offline; thin segregation of duties | Mobile signing, prod access | 3 | 4 | 12 | Offline storage (Process); no recorded backup or recovery | 12 | Document key custody and recovery; second custodian; compensating logging (Sam/Jeff) | 5.3, 8.24 |
| R-14 | CODEOWNERS gives no independent review (only John listed) | Security paths | 3 | 3 | 9 | File exists (Implemented) | 9 | Add Sam's reviewers' real handles when available (John) | 5.3, 8.32 |
| R-15 | Data loss: database or file corruption, ransomware, accidental deletion | Aurora/Linode DB, S3 | 2 | 5 | 10 | Aurora PITR 35 d, AWS Backup Vault Lock, Melbourne copies, Object Lock on evidence bucket (Designed; evidence bucket Terraform exists) | 10 | First restore test and DR tabletop (Jeff/Sam, P1 #8); no restore ever tested | 8.13, 5.29, 5.30 |
| R-16 | Region outage (Sydney) or provider failure | Availability | 2 | 4 | 8 | Melbourne copies, restore runbook (Designed) | 8 | Region-failover tabletop yearly (P7) | 5.30, 8.14 |
| R-17 | Notifiable data breach not detected or handled in time (30-day assessment, OAIC and customer notice) | Privacy, APP 11 | 3 | 5 | 15 | NDB steps in doc 08 §5; IR policy P6 (Process, never exercised) | 12 | Tabletop exercise; incident log started; lawyer-reviewed customer notice templates (Sam/Grace, John engages lawyer) | 5.24-5.28, 5.34 |
| R-18 | Personal and sensitive data (workers' IDs, licences, health in incident reports, GPS sign-in) over-collected or retained | Workforce, safety, declarations modules | 3 | 4 | 12 | Minimal fields; retention schedule docs 07 §6/08; deletion jobs designed, not evidenced (Partial) | 9 | Evidence deletion jobs; data-minimisation review per module (Grace) | 5.34, 8.10, 8.11 |
| R-19 | Offshore sub-processors receive data contrary to APP 8 and the residency promise | Sub-processors | 3 | 4 | 12 | Sub-processor list now written ([04](04-sub-processors.md)); egress allow-list with `pnpm check:egress` (Implemented for AI endpoints) | 9 | Resolve Sentry region (R-22), sign DPAs, publish list with 30-day notice (Sam/Grace, John signs) | 5.19-5.23, 5.34 |
| R-20 | AI outputs cause a wrong legal or financial outcome (SOPA claim, payment, compliance check) or AI processing leaves Australia | `ai` module, Nova | 3 | 4 | 12 | All AI via `ai` module; vendor SDKs only in `providers/`; `pnpm check:boundaries` and `check:egress`; human confirmation for regulated actions; no training on customer data (Implemented in code) | 6 | Golden-set evals for regulated answers (Ari/Grace) | 5.34, 8.26, 5.23 |
| R-21 | SOPA/payment-deadline harm from an outage or defect | Financials module | 2 | 4 | 8 | Outage reports must state SOPA impact (infra/05); record-and-remind only (Process) | 6 | Lawyer review before P2 claims (John) | 5.31, 5.30 |
| R-22 | Crash tracking (Sentry, US/EU) sends personal data offshore | Observability | 3 | 3 | 9 | PII scrubbing designed (no bodies, no names/emails); **no Sentry code in repo yet** (Designed) | 6 | Pick an AU-capable option or self-host in Sydney before enabling; add scrub tests (Jeff/Sam) | 5.23, 8.15 |
| R-23 | File upload carries malware or hostile content | `modules/files` | 3 | 4 | 12 | ClamAV scanner and S3 scanner code exist (`modules/files`); GuardDuty Malware Protection designed | 6 | Confirm quarantine path in tests (Quinn) | 8.7 |
| R-24 | Mobile device lost or stolen with offline data | Mobile app, sync | 3 | 3 | 9 | Encrypted on-device DB, 7-day offline window, wipe-on-revoke (Designed, doc 01 §8) | 6 | Verify wipe-on-revoke works in the Expo build (Mia) | 8.1, 6.7 |
| R-25 | Staff laptops unmanaged, unencrypted, or used with customer data | Endpoints | 3 | 4 | 12 | Policy P9 only; no MDM or evidence (Process) | 12 | Device checklist and annual attestation; MDM decision when team grows (Sam/John) | 8.1, 6.7, 7.9 |
| R-26 | No security training, background checks or confidentiality agreements recorded | People | 4 | 3 | 12 | None (Process) | 12 | Onboard records; yearly training; screening for prod access (John/Sam, P1 #10) | 6.1-6.3, 6.6 |
| R-27 | Third-party integration compromise (Xero, MYOB, Google Drive OAuth tokens stored by us) | `modules/integrations` | 2 | 4 | 8 | OAuth tokens encrypted (confirm in review); scopes minimal (`drive.file`) | 6 | Verify token encryption and revocation on disconnect (Ben) | 5.19, 8.24 |
| R-28 | Outbound webhooks or SMS/email abused (spam, data leakage, Spam Act) | `integrations`, worker email/SMS | 2 | 3 | 6 | Webhook transport, SES (Sydney), Twilio `au1` (Implemented); unsubscribe on marketing (Designed) | 4 | Rate limits and allow-list review (Ben) | 8.20, 5.14 |

## Top residual risks for John (>= 15 or blocking)

R-02 (no production), R-04 (no security audit log), R-05 (no infra logging), R-07 (staff MFA unverified). Treatments are P0 items in the readiness plan. R-10, R-13, R-17, R-25, R-26 are next (residual 12).

## Risk acceptance

Nothing is accepted yet. Acceptance line per high or blocking risk: risk ID, reason, expiry date, signed John ______ Sam ______.

## Change log

v1 21 Nov 2026: first register, from repo state at `main` (after PR #635).
