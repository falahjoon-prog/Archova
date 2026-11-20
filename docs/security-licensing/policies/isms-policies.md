# Archova information security policies (v1 draft)

Status: draft for John's approval, 20 Nov 2026. Owner: Sam. Review yearly and after any major incident. Each policy cites the control that implements it so an auditor can follow it to evidence. Approval line: John (top management), date ______.

**Scope:** the Archova platform (web, mobile, API, AI, owner console), its AWS/hosting accounts, source code, staff devices and accounts, and customer data we process.

## P1. Information security policy
- Security is owned by Sam (Security) and accountable to John. Goals: protect customer data, keep tenants isolated, keep data in Australia, meet ISO 27001 and later SOC 2.
- Controls fail closed (doc 09 §9). Exceptions need written approval from Sam and John and an expiry date, recorded in the exceptions log.
- Breaking policy is handled under HR process; reporting a mistake early is never penalised.

## P2. Access control
- Least privilege, role based. Customer data access by staff only through support sessions: ticket required, grant up to 72 h, session up to 60 min, all logged (`support_events`).
- MFA mandatory on GitHub, cloud, email, password manager and the owner console. Production access via IAM Identity Center, just-in-time, no shared or long-lived keys.
- Joiners get access by role; leavers lose all access the same day. Access reviews every quarter by Sam; the signed review is kept as evidence.
- Product users: passwords with breach checks, TOTP or passkeys, session rules per doc 01.

## P3. Data classification and handling
- Classes: Public; Internal; Customer confidential (all tenant data); Restricted (secrets, keys, personal and health information, financial evidence).
- Customer data never goes to laptops, personal accounts, tickets or AI tools outside the `ai` module. Test and demo use sample data only.
- All data stays in Australia (see the residency statement); sub-processors approved under P8 only.
- Encryption: TLS 1.2+ in transit, KMS at rest, app-level encryption for secrets (doc 09 §2). Retention and deletion per docs 07 §6 and 08; legal hold overrides deletion.

## P4. Secure development and change management
- All changes via pull request into `main`, squash merge, CI green on the head commit (tests, lint, typecheck, boundaries, gitleaks, audit, DAST). No merge while CI is down; any exception is recorded with John's written approval.
- Security-sensitive paths (auth, permissions, payments, raw SQL, file upload, tenant context, crypto) get a security review; CODEOWNERS enforces it.
- Migrations are forward-only. Production changes only through infrastructure as code and the deploy pipeline; emergency changes are recorded afterwards within one business day.
- Vulnerability fix SLAs: critical 48 h, high 7 days, medium 30 days (doc 09 §7). Yearly external penetration test and before major launches.

## P5. Logging and monitoring
- Record: business events (audit log), security events (sign-in, MFA, role changes, exports, tokens, staff actions), and cloud events (CloudTrail, GuardDuty, Config).
- Audit logs are append-only, kept 7 years, and cannot be edited by staff; alert rules per doc 07 §9. Time is NTP-synced UTC.
- Logs reviewed: alerts triaged daily by on-call; security log sampled monthly by Sam.

## P6. Incident response
- Severity: S1 data exposure or outage of all tenants, S2 partial, S3 minor, S4 near miss. Anyone reports to the incident channel and Sam; Sam or delegate is incident lead.
- Steps: contain, preserve evidence, assess, notify, recover, review. A suspected data breach goes through the Notifiable Data Breaches assessment (doc 08 §5): assess within 30 days, notify OAIC and affected people if serious harm is likely, customers informed per contract without undue delay.
- Blameless post-incident review within 5 business days; actions tracked to done. Tabletop exercise twice a year.

## P7. Business continuity and backup
- Targets and methods per docs/infrastructure/06 (RPO/RTO by scenario, Melbourne copies, Vault Lock).
- Restore test every quarter (one tenant restore and one full-cluster restore per year); region-failover tabletop yearly. Results are kept as evidence and fixed in the runbook.

## P8. Supplier and sub-processor management
- Before any supplier touches customer data: security review (certifications, region, data sent), DPA signed, entry added to the sub-processor register (supplier, purpose, data, region, review date).
- Reviewed yearly. Customers get notice of new sub-processors before use (30 days for Enterprise).
- No AI vendor outside the `ai` module and Australian regions (X25/X26).

## P9. People security
- Background check for anyone with production or customer-data access. Confidentiality agreement signed before access.
- Security training at onboarding and yearly (phishing, data handling, incident reporting); completion recorded.
- Company devices (or approved personal devices) with disk encryption, screen lock, auto-updates and endpoint protection; lost devices reported immediately and wiped.

## P10. Acceptable use and AI
- Use of AI coding assistants is allowed on source code and sample data, never on customer data or secrets.
- Nova features that touch legal or financial outcomes require human confirmation (doc 09 §6).

## P11. Risk management
- Risk register (likelihood x impact, owner, treatment) reviewed quarterly and when a new module or supplier is added; top risks reported to John. Statement of Applicability maps controls to ISO Annex A.

## Records the policies create (keep as audit evidence)
Access review sign-offs; support-session log; change log (PRs and CI results); exceptions log; incident log and reviews; restore-test reports; pen-test report and fixes; training and screening records; sub-processor register; risk register; management review minutes.
