# 10. ISO 27001 / SOC 2 readiness report

Owner: Sam (Security) with Grace (Compliance) review. Status: draft v1, 20 Nov 2026. Evidence base: this repo at `main` (PR #613) and docs 01–09.
Decision on record: **ISO 27001 first** (2 Oct 2026). SOC 2 Type II follows; most controls overlap, so this report maps both.

## 1. Bottom line

The *design* is strong and covers most ISO Annex A / SOC 2 Trust Services topics. The *evidence* is thin, because production has never been deployed (AWS is validated in Terraform, nothing applied; the pilot runs on John's PC and a Cloudflare tunnel). An auditor tests controls that operate over time, so the main gap is not paper, it is **running the controls and keeping records of them**.

Certification needs an external accredited body (ISO) or CPA firm (SOC 2). That engagement is John's to commission. Do not start the audit window until production is live and the P0 list in §5 is done: a SOC 2 Type II observation period (3–12 months) only starts counting once controls run.

## 2. What is already in place (with where to find it)

| Area | Evidence in repo |
|---|---|
| Tenant isolation | Postgres RLS on every tenant table (`kernel.enable_tenant_rls`), every use case in `withTenantTx`, cross-tenant test suite (doc 03) |
| Identity and sessions | In-house identity module: password, TOTP, passkey; `__Host-sid` sessions, API tokens, OAuth (doc 01, `modules/identity`) |
| Staff access to customer data | Backoffice support access: time-boxed grants (72 h), sessions (60 min), append-only `support_events` and `staff_audit` tables with immutability triggers |
| Business audit trail | Audit log screen (reads `shared.outbox` domain events: who did what, when, filterable) in `modules/reporting` |
| Evidence retention | `claims-evidence` bucket, Object Lock compliance mode, 3653 days (PR #375) |
| Secure SDLC | CI: gitleaks secret scan, `pnpm audit` (high+), CodeQL (switchable), ZAP DAST, Checkov/tflint on IaC, Trivy on images, boundary checks, conventional commits, PR-only merges to `main` |
| AU residency by design | SCP denies all regions except ap-southeast-2/4; Bedrock limited to AU resources; AI egress firewall allow-list; X25/X26 |
| Cloud guardrails | SCP blocks disabling CloudTrail, GuardDuty, Config, Security Hub; Control Tower multi-account plan with log-archive account (Object Lock) |
| Backup and DR | Aurora PITR 35 d, AWS Backup with Vault Lock, Melbourne copies, restore runbook (docs/infrastructure/06, `runbooks/linode-restore.md`) |
| Encryption | KMS everywhere by design, per-env KMS key for BYO AI secrets, TLS 1.2+ (doc 09 §2) |
| Privacy | APP-by-APP mapping and NDB breach steps (doc 08) |

## 3. Gaps found (verified against code, not just docs)

1. **Security audit log is not built.** Doc 07 specifies a hash-chained, WORM-anchored security log (logins, MFA, permission changes, exports, token creation). In code there is no such table: the Audit log screen reads business events from `shared.outbox`, and login/MFA/permission/export events are not recorded as audit events. No hash chain, no S3 anchor, no verifier job, no security alerts (doc 07 §4, §9).
2. **Infrastructure/admin access logging is design-only.** CloudTrail, GuardDuty, Config, Security Hub and the log-archive account are referenced by SCPs and docs but have no Terraform resource in `infra/`; they depend on Control Tower, which has not been set up. Staff console actions are only partly audited (legal holds and support sessions; other `org-actions` are not in `staff_audit`).
3. **Production does not exist yet.** No applied AWS account; pilot hosting is a PC plus a Cloudflare quick tunnel (Cloudflare is a US company and traffic transits its network outside AU). Evidence of backups, restore tests, patching and monitoring cannot exist until real hosting is live.
4. **Repo hygiene claims not matched by files:** no `CODEOWNERS` (doc 09 §7 requires security review of auth/permissions/billing/crypto paths), no `dependabot.yml`/Renovate config, no `SECURITY.md` / vulnerability disclosure policy. CodeQL runs only if `CODE_SCANNING_ENABLED` is set (needs GitHub Advanced Security on a private repo). CI has been down or unreliable in November, and several PRs merged without CI; a change-management auditor will sample these.
5. **No ISMS paperwork** before this PR: no information security policy set, risk register, statement of applicability, asset inventory, supplier register, access review records, training records, or management review. Policies are drafted in `policies/isms-policies.md` (new).
6. **Not yet done by people, not code:** external penetration test (budgeted per phase end, none done), lawyer review of privacy/terms (Grace D1), BCP/DR test (never exercised), security awareness training, background checks for anyone with production access, tabletop exercise.
7. **Sub-processor list is promised, not written** (Stripe, email provider, error tracking, AWS, Cloudflare for the pilot tunnel). Needed for APP 8 and for customer DPAs.
8. **Single-person key risk:** John and Jeff hold mobile signing keys offline; segregation of duties is thin for a small team, which auditors accept only with compensating controls (PR review, logging).

## 4. Evidence an auditor will ask for, and our status

| # | Evidence / control | ISO 27001:2022 | SOC 2 | Status |
|---|---|---|---|---|
| 1 | ISMS scope, policy set, risk assessment, SoA | 4–6, 5.1 | CC1, CC3 | Drafted (this PR); risk register and SoA still to do |
| 2 | Asset and data inventory | 5.9 | CC6.1 | Missing (modules/tables list exists, no register) |
| 3 | Access control, MFA, joiner/mover/leaver | 5.15–5.18, 8.2–8.5 | CC6.1–6.3 | Product MFA built; staff MFA via IAM Identity Center is design-only; no review records |
| 4 | Quarterly access reviews | 5.18 | CC6.2–6.3 | Missing: no records |
| 5 | Logging and monitoring | 8.15–8.16 | CC7.2 | Partial: app events yes; security events and infra logs not built |
| 6 | Encryption at rest and in transit | 8.24 | CC6.1, CC6.7 | Design only until AWS is applied |
| 7 | Change management and code review | 8.32, 8.25–8.29 | CC8.1 | Good (PR-only, CI gates); weakened by CI outage merges; no CODEOWNERS |
| 8 | Vulnerability management, patch SLAs | 8.8 | CC7.1 | Scans exist; no dependabot, no SLA tracking |
| 9 | Penetration test | 8.8, 8.29 | CC4.1, CC7.1 | None done |
| 10 | Backup and restore test evidence | 8.13 | A1.2–1.3 | Documented; no tests run |
| 11 | Incident response plan, tabletop, post-incident reviews | 5.24–5.28 | CC7.3–7.5 | Drafted (this PR); no exercise yet |
| 12 | BCP/DR | 5.29–5.30 | A1.2 | Documented; never exercised |
| 13 | Vendor / supplier management | 5.19–5.23 | CC9.2 | Missing: sub-processor list, supplier reviews, DPAs |
| 14 | HR security: screening, training, offboarding | 6.1–6.5 | CC1.4 | Missing: no training or screening records |
| 15 | Physical security | 7.x | CC6.4 | Inherited from AWS (collect AWS Artifact reports); the pilot PC is out of scope only once production is live |
| 16 | Data retention and disposal | 8.10, 5.33 | C1.2, P4 | Designed (docs 07 §6, 08); deletion jobs not evidenced |
| 17 | Privacy (SOC 2 Privacy optional) | 5.34 | P1–P8 | Doc 08; privacy policy not published |
| 18 | Management review, internal audit | 9.2–9.3 | CC1, CC2 | Not started |

## 5. Prioritised plan before commissioning an audit

**P0, blocks any audit (build or decide)**
1. Deploy real production hosting (AWS Sydney per infra docs, or the Linode option as an interim), and stop describing the PC demo as the product. Owner: Jeff, John decides.
2. Build the security audit log per doc 07 (auth, MFA, role/membership changes, exports, token creation, staff console actions) with append-only triggers; hash chain and S3 anchor can follow in the same module. Owner: Ben with Sam.
3. Stand up Control Tower plus org CloudTrail, Config, GuardDuty, Security Hub, log-archive in Terraform. Owner: Jeff.
4. Add `CODEOWNERS` (needs the real GitHub handles of Sam's/Ben's reviewers), `dependabot.yml`, `SECURITY.md` (needs a real security mailbox such as security@archova.com.au; John to create it), and enable CodeQL.
5. Adopt the policy set in `policies/isms-policies.md` formally (John signs as top management) and start the records: access review, training, incident log, change log. Owner: Sam, Grace.

**P1, needed before the audit window opens**
6. Risk register, asset inventory, Statement of Applicability (ISO), sub-processor list and DPA template.
7. Staff SSO plus MFA for GitHub, AWS and Google Workspace; document it.
8. First restore test and DR tabletop; keep the report as evidence.
9. External penetration test (web, API, mobile) and fix findings.
10. Security awareness training and background-check process for production access.
11. Cut the CI-down merge exception: no merges without green CI, record any exceptions with approval.

**P2, before certification**
12. Internal audit and management review; optional ISO gap assessment by a consultant.
13. Choose a body: ISO 27001 (Stage 1 and 2, three-year cycle) and, if enterprise customers ask, SOC 2 Type II via a platform such as Vanta or Drata to automate evidence collection (a paid decision for John).

## 6. Decisions for John

- Approve the policy set as v1 (it is a draft until you sign).
- Create a security@ mailbox and tell us the address for SECURITY.md.
- Decide production hosting and date; the residency statement cannot be published until then (see `11-data-residency-statement.md`).
- Later: pick an auditor and whether to buy an evidence-automation tool.

Not legal or certification advice; Sam and Grace review before anything here is shown to customers.
