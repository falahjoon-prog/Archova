# Statement of Applicability (v1 draft, 21 Nov 2026)

ISO/IEC 27001:2022 Annex A, 93 controls. Owner: Sam. Approval: John ______ date ______.

"Applicable" is Y unless excluded with a reason. Status uses the README vocabulary: Implemented, Partial, Designed, Planned, Process, N/A. "Evidence" names where an auditor can look today. Risk IDs refer to [01-risk-register.md](01-risk-register.md). Doc numbers are in `docs/security-licensing/` (e.g. 09 = security baseline) unless a path is given. Inherited AWS controls need AWS Artifact reports once production exists.

## A.5 Organisational controls

| # | Control | App. | Status | Evidence / where | Gap / risk |
|---|---|---|---|---|---|
| 5.1 | Policies for information security | Y | Partial | `policies/isms-policies.md` (P1-P11) | Draft; John must sign (R-26) |
| 5.2 | Roles and responsibilities | Y | Partial | Named personas in docs; policy P1 gives Sam ownership | No formal RACI or appointment letter |
| 5.3 | Segregation of duties | Y | Partial | PR review, support grant approval | Thin team; R-13, R-14 |
| 5.4 | Management responsibilities | Y | Process | P1 top-management sign-off | No records |
| 5.5 | Contact with authorities | Y | Partial | NDB steps to OAIC (08 §5); ASD ransomware reporting (08) | No contact list |
| 5.6 | Contact with special interest groups | Y | Planned | None | Join ACSC alerts, AWS security bulletins |
| 5.7 | Threat intelligence | Y | Planned | GuardDuty designed | R-05 |
| 5.8 | Information security in project management | Y | Partial | Security review for sensitive paths; docs-first design | Not recorded per project |
| 5.9 | Inventory of information and assets | Y | Partial | [03-asset-inventory.md](03-asset-inventory.md) | First version; needs quarterly review |
| 5.10 | Acceptable use | Y | Partial | P10, P9 | No signed acknowledgements |
| 5.11 | Return of assets | Y | Process | P2 leavers same day | No offboarding checklist |
| 5.12 | Classification of information | Y | Partial | P3 classes; per-asset class in 03 | Labels not applied in tooling |
| 5.13 | Labelling of information | Y | Planned | None | Low priority |
| 5.14 | Information transfer | Y | Partial | TLS 1.2+, presigned URLs, email via SES (Sydney) | No transfer rules for staff |
| 5.15 | Access control | Y | Implemented | RLS, roles (02), support grants, `modules/access`, `modules/identity` | Staff-side IdP designed only (R-07) |
| 5.16 | Identity management | Y | Implemented | Identity module (01) | Staff identities not centralised |
| 5.17 | Authentication information | Y | Partial | Password breach check, TOTP, passkeys; secrets in Secrets Manager (designed) | R-06, R-09 |
| 5.18 | Access rights | Y | Process | P2 quarterly review | No review records (R-08) |
| 5.19 | Supplier relationships | Y | Partial | [04-sub-processors.md](04-sub-processors.md) | No supplier reviews (R-19) |
| 5.20 | Security in supplier agreements | Y | Planned | DPA template promised | None signed that we can show |
| 5.21 | ICT supply chain | Y | Implemented | dependabot, `pnpm audit`, Trivy, lockfile | R-11 |
| 5.22 | Monitoring supplier services | Y | Planned | P8 yearly review | None done |
| 5.23 | Cloud services | Y | Designed | AWS org plan, SCP region deny (infra/01, `infra/org/scps.tf`), Linode option | R-02 |
| 5.24 | Incident management planning | Y | Partial | P6, NDB steps, runbooks index (infra/08) | Never exercised (R-17) |
| 5.25 | Assessment of security events | Y | Partial | P6 severities | No security event feed (R-04) |
| 5.26 | Response to incidents | Y | Partial | P6, infra/05 incident notes | No incident log |
| 5.27 | Learning from incidents | Y | Process | Blameless review in P6 | No reviews yet |
| 5.28 | Collection of evidence | Y | Partial | Append-only support tables; Object Lock `claims-evidence` bucket (PR #375) | Security log missing (R-04) |
| 5.29 | Security during disruption | Y | Designed | infra/06, `runbooks/linode-restore.md` | Never tested (R-15) |
| 5.30 | ICT readiness for continuity | Y | Designed | Melbourne copies, restore runbook | R-15, R-16 |
| 5.31 | Legal, statutory, regulatory requirements | Y | Partial | docs/compliance (SOPA, WHS, privacy), doc 08 | Lawyer review pending (Grace D1) |
| 5.32 | Intellectual property rights | Y | Partial | Licensed deps tracked by pnpm | No licence-scan in CI (confirm) |
| 5.33 | Protection of records | Y | Partial | Retention docs 07 §6; Object Lock evidence bucket | Deletion jobs not evidenced (R-18) |
| 5.34 | Privacy and PII protection | Y | Partial | doc 08 APP mapping; docs/compliance/06 | Privacy policy unpublished (R-18, R-19) |
| 5.35 | Independent review of information security | Y | Planned | None | Internal audit then external |
| 5.36 | Compliance with policies and standards | Y | Process | CI gates enforce P4 | No compliance checks recorded |
| 5.37 | Documented operating procedures | Y | Partial | `docs/runbooks`, infra/08 | Few runbooks written |

## A.6 People controls

| # | Control | App. | Status | Evidence / where | Gap / risk |
|---|---|---|---|---|---|
| 6.1 | Screening | Y | Process | P9 | No records (R-26) |
| 6.2 | Terms and conditions of employment | Y | Process | P9 | Contracts not reviewed for security clauses |
| 6.3 | Awareness, education, training | Y | Process | P9 | No training done |
| 6.4 | Disciplinary process | Y | Process | P1 | Not formalised |
| 6.5 | Responsibilities after termination | Y | Process | P2 | Part of offboarding checklist (missing) |
| 6.6 | Confidentiality or NDAs | Y | Process | P9 | No signed set |
| 6.7 | Remote working | Y | Partial | P9 device rules | Unverified (R-25) |
| 6.8 | Information security event reporting | Y | Partial | P6 reporting channel | No channel or SECURITY.md yet |

## A.7 Physical controls

| # | Control | App. | Status | Evidence / where | Gap / risk |
|---|---|---|---|---|---|
| 7.1 | Physical security perimeters | Y | Partial | Inherited from AWS/Linode | Collect AWS Artifact reports; office/home N/A until premises exist |
| 7.2 | Physical entry | Y | Partial | Inherited | As 7.1 |
| 7.3 | Securing offices, rooms, facilities | N/A | N/A | No company premises (remote team) | Revisit if an office is opened |
| 7.4 | Physical security monitoring | Y | Partial | Inherited | As 7.1 |
| 7.5 | Protecting against physical threats | Y | Partial | Inherited; two AU regions | As 7.1 |
| 7.6 | Working in secure areas | N/A | N/A | No secure areas | |
| 7.7 | Clear desk and clear screen | Y | Process | P9 screen lock | No evidence |
| 7.8 | Equipment siting and protection | Y | Partial | Inherited for cloud | Staff devices R-25 |
| 7.9 | Security of assets off-premises | Y | Process | P9 | R-03, R-25 |
| 7.10 | Storage media | Y | Process | P3 (no customer data on laptops) | No removable-media rule |
| 7.11 | Supporting utilities | Y | Partial | Inherited | |
| 7.12 | Cabling security | N/A | N/A | Cloud only | |
| 7.13 | Equipment maintenance | Y | Partial | Inherited for cloud | |
| 7.14 | Secure disposal or re-use of equipment | Y | Process | P9 wipe lost devices | No disposal records |

## A.8 Technological controls

| # | Control | App. | Status | Evidence / where | Gap / risk |
|---|---|---|---|---|---|
| 8.1 | User endpoint devices | Y | Process | P9; mobile encrypted DB (01 §8) | R-24, R-25 |
| 8.2 | Privileged access rights | Y | Partial | Support grants, console roles (`modules/backoffice`); IAM Identity Center designed | R-07, R-08 |
| 8.3 | Information access restriction | Y | Implemented | RLS on every tenant table, RBAC (02), `withTenantTx` | R-01 |
| 8.4 | Access to source code | Y | Implemented | GitHub private repo, CODEOWNERS | Only one reviewer (R-14) |
| 8.5 | Secure authentication | Y | Implemented | Password, TOTP, passkey, session rules (01) | R-06 |
| 8.6 | Capacity management | Y | Designed | infra/04 scaling and load, `loadtest` env | No production data |
| 8.7 | Protection against malware | Y | Partial | `modules/files` ClamAV scanner; GuardDuty Malware Protection designed | R-23 |
| 8.8 | Management of technical vulnerabilities | Y | Partial | pnpm audit, Trivy, ZAP, dependabot, CodeQL (switchable) | No pen test, no SLA tracking (R-10, R-11) |
| 8.9 | Configuration management | Y | Partial | Terraform, Checkov/tflint in CI | Nothing applied (R-02) |
| 8.10 | Information deletion | Y | Partial | Deletion pipeline (03 §8), account deletion migration | Not evidenced (R-18) |
| 8.11 | Data masking | Y | Partial | Log redaction rules; PII scrubbing for crash tracking designed | R-22 |
| 8.12 | Data leakage prevention | Y | Partial | Egress allow-lists, `check:egress`, AI boundaries, presigned URLs | No DLP tooling (acceptable at this size) |
| 8.13 | Information backup | Y | Designed | Aurora PITR, AWS Backup Vault Lock, `host/backup` for Linode | R-15 |
| 8.14 | Redundancy | Y | Designed | Multi-AZ Aurora, Melbourne copies | R-16 |
| 8.15 | Logging | Y | Partial | pino JSON logs, business audit log, `support_events`, `staff_audit` | R-04, R-05 |
| 8.16 | Monitoring activities | Y | Designed | infra/05 (CloudWatch, Grafana, GuardDuty) | No alerts live |
| 8.17 | Clock synchronisation | Y | Partial | UTC everywhere (`@archova/time`); AWS NTP inherited | |
| 8.18 | Use of privileged utility programs | Y | Partial | No BYPASSRLS roles; owner console separate (port 3008, private) | Prod DB access procedure undefined |
| 8.19 | Installation of software on operational systems | Y | Implemented | Immutable images built in CI (`images.yml`), Trivy | Prod unproven |
| 8.20 | Network security | Y | Designed | VPC, WAF (`cloudfront-waf`), Network Firewall / CoreDNS allow-list | R-02, R-03 |
| 8.21 | Security of network services | Y | Designed | As 8.20; TLS 1.2+, HSTS at CloudFront | |
| 8.22 | Segregation of networks | Y | Designed | Per-env accounts, VPC, cells | |
| 8.23 | Web filtering | Y | Designed | Egress allow-list (`egress-allowlist.yaml`) | |
| 8.24 | Use of cryptography | Y | Designed | KMS design (09 §2), per-env key for BYO AI secrets, `infra/modules/kms-key` | Key custody R-13 |
| 8.25 | Secure development life cycle | Y | Implemented | CLAUDE.md rules, ADRs, CI gates, contract-first OpenAPI | |
| 8.26 | Application security requirements | Y | Implemented | Doc 09 baseline; per-module threat notes | |
| 8.27 | Secure system architecture and engineering principles | Y | Implemented | ADRs 0001-0008, module boundaries (`check:boundaries`) | |
| 8.28 | Secure coding | Y | Implemented | Lint, typecheck, strict boundaries, CodeQL (if enabled) | CodeQL off by default |
| 8.29 | Security testing in development and acceptance | Y | Partial | Unit/integration/cross-tenant tests, ZAP DAST | No pen test (R-10) |
| 8.30 | Outsourced development | N/A | N/A | No outsourced developers (AI coding assistants covered by P10) | Revisit if contractors added |
| 8.31 | Separation of development, test, production | Y | Designed | `envs/` dev, staging, prod-cell1 separate | Prod absent |
| 8.32 | Change management | Y | Partial | PR-only, squash merge, CI; migrations forward-only | R-12 |
| 8.33 | Test information | Y | Implemented | Sample data only (P3) | |
| 8.34 | Protection of information systems during audit testing | Y | Process | P4 | Define when audit starts |

## Counts (21 Nov 2026)

Of 93 controls: 4 N/A (7.3, 7.6, 7.12, 8.30), 89 applicable. Strictly Implemented today: 5.15, 5.16, 5.21, 8.3, 8.4, 8.5, 8.19, 8.25-8.28, 8.33 (12). The rest are Partial, Designed, Process or Planned. Expect auditors to test operation over time, so Designed and Process controls need records before they count.

## Exclusion rationale

7.3, 7.6, 7.12: no premises or cabling, fully remote and cloud. 8.30: no outsourced development. Re-assess at each review.

## Change log

v1 21 Nov 2026: first SoA from repo at `main`. To review by Sam and Grace.
