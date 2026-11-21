# Asset and data inventory (v1, 21 Nov 2026)

Owner: Sam; data owners per row. Classes from P3: Public, Internal, Customer confidential (CC), Restricted (R). Built from `modules/` (46 modules, about 320 tables in `modules/*/db/migrations`), `infra/`, `.github/` and docs. Review quarterly; a new module adds a row to section 1 in the same PR (policy P11).

## 1. Information assets by module (system of record: Postgres, schema per module, RLS on tenant tables)

Customer data is tenant-scoped. All of it is at least CC. "Personal" marks personal information under the Privacy Act; "Sensitive" marks health or similar.

| Module(s) | Data held | Class | Personal / sensitive | Notes |
|---|---|---|---|---|
| `identity`, `access` | Accounts, emails, password hashes, TOTP and passkey credentials, sessions, API tokens, partner apps, org membership and roles | R | Personal | Secrets hashed or encrypted; `__Host-sid` sessions |
| `billing`, `platform` | Subscriptions, plans, usage, entitlements, tenant config | CC | Minimal personal (billing contacts) | Payment card data not held; goes to Stripe (04) |
| `backoffice` | Staff console, support grants, `support_events`, `staff_audit`, legal holds | R | Staff and customer references | Append-only, immutability triggers |
| `workforce`, `contractors` | Workers, licences, tickets and wallet items, expiry alerts, worker ID badge, company details, ABN; GPS sign-in (12 months) and gate selfie (30 days); licence card images and numbers (APP 9 government identifiers) | R | Personal. Drug/alcohol results and medical certificates are Sensitive; a yes/no fit-for-work declaration is Personal; insurance certificates are Personal for sole traders | Largest personal-data set; retention per docs/compliance/07 §3 |
| `safety` (incidents) | Incident reports with injury and health detail | R | Sensitive (health) | Needs the incident-health permission; excluded from Nova context, push, SMS and logs |
| `safety` (SWMS), `quality`, `defects`, `environment`, `permits`, `insurance` | SWMS, inspections, observations, defect and warranty records, permits, insurance and bonds | CC | Incidental personal data | WHS records; retention per docs/compliance/07 §3 |
| `declarations` | Subcontractors' statements and statutory declarations | R | Personal (signer data) | Evidence: sealed and immutable; exact signed content preserved |
| `financials`, `estimating`, `precon` | Budgets, cost codes, commitments, payment claims and schedules, invoices, estimates, bids, quotes | CC | Some personal (contact names) | SOPA evidence; commercially sensitive |
| `documents`, `files`, `submittals`, `rfis`, `handover`, `bim`, `links`, `exports` | Drawings, specifications, models, photos, attachments, transmittals | CC | Incidental personal (photos) | Object store; virus-scanned |
| `esign` | Signature requests, signed PDFs, signer identity and audit trail | R | Personal | Legal evidence |
| `correspondence`, `conversations`, `notifications`, `announcements`, `meetings`, `diary` | Emails, messages, notices, meeting minutes, daily diaries | CC | Personal | Email content in and out |
| `scheduling`, `logistics`, `plant`, `prefab`, `geotech`, `workflows`, `sync`, `search`, `recents`, `bookmarks`, `reporting` | Programmes, deliveries, equipment, fabrication, geotech data, workflow state, offline sync, search index, usage and the audit log screen | CC | Minimal | Reporting reads `shared.outbox` domain events |
| `integrations`, `ownerportal` | OAuth tokens and connection settings for Xero, MYOB, Google Drive; webhook configs; owner portal access | R (tokens) | Personal | Tokens must be encrypted (R-27) |
| `ai` | Prompts, outputs, embeddings, usage and cost, customer BYO AI role config | R | May contain personal data | AU-only; not used to train models |
| Shared (`kernel`, `shared.outbox`) | RLS helpers, domain event outbox, tenant context | CC | Indirect | |

## 2. Systems and infrastructure

| Asset | What | Class held | Owner | State |
|---|---|---|---|---|
| Aurora PostgreSQL (prod-cell1) / Linode managed Postgres 16 | Primary datastore | R | Jeff | Designed, not applied |
| S3 buckets (files, `claims-evidence` Object Lock 3653 d, backups, logs) | Files, evidence, backup | R | Jeff | Designed; evidence bucket Terraform in repo |
| Valkey cache (`infra/modules/valkey`) | Sessions/cache/queues | CC | Jeff | Designed |
| ECS services: `api`, `web`, `worker`, `ai-worker` | Application runtime | CC | Jeff | Designed; images built in CI |
| CloudFront + WAF, Route 53, ACM | Edge | Public | Jeff | Designed |
| KMS keys (`infra/modules/kms-key`) | Encryption keys | R | Jeff / Sam | Designed |
| Secrets Manager entries (`archova/<env>/...`) | API creds (ABR GUID, BOM, Twilio, etc.) | R | Jeff | Designed |
| AWS Organization, SCPs, Control Tower, log-archive account | Governance and logging | R | Jeff | SCPs coded; Control Tower and logging not built (R-05) |
| Owner console (port 3008, private) | Staff operations | R | Ben / Sam | Implemented in repo |
| Pilot demo on John's PC with Cloudflare quick tunnel (web 3007) | Demo only, sample data | Internal | John | Running ad hoc; out of production scope (R-03) |
| Email (SES, Sydney), SMS (Twilio au1), push (Expo/APNs/FCM) | Messaging | CC | Ben | Email and SMS coded in `apps/worker`; push planned |
| Observability: CloudWatch, Prometheus/Grafana, X-Ray, Sentry, PagerDuty | Logs, metrics, crashes, paging | CC (logs redacted) | Jeff | Designed; no Sentry code |

## 3. Code, build and delivery

| Asset | Class | Owner | Notes |
|---|---|---|---|
| GitHub repo `falahjoon-prog/archova` (private), branches, PRs | R (source), Internal | John | CODEOWNERS and dependabot present; MFA to verify |
| GitHub Actions workflows (`ci`, `security`, `dast`, `images`, `infra`, `deploy`, `mobile-apk`, `linode-*`) and, when the `CI_RUNNER` variable is set, a self-hosted runner (reported to be on John's PC, WSL2) | R (can reach secrets) | Jeff | A self-hosted runner on an unmanaged host that can reach CI secrets is a risk; prefer GitHub-hosted or ephemeral runners (R-29) |
| Container images, mobile builds (Android APK, EAS) | Internal | Jeff / Mia | Mobile signing keys held offline by John and Jeff (R-13) |
| OpenAPI contract `packages/contracts` | Public-ish | Ava | |
| Documentation `docs/`, `/mnt/project-files` | Internal | Priya | Contains design, no customer data |

## 4. People-held and endpoint assets

| Asset | Class | Notes |
|---|---|---|
| Staff laptops and phones (John, Jeff and team) | Internal / R | Encryption and patching unverified (R-25) |
| Staff accounts: GitHub, Google Workspace, AWS, Expo, Stripe, Twilio, Cloudflare | R | MFA enforcement to verify and record (R-07) |
| Mobile signing keys and app store accounts | R | Offline, two custodians (R-13) |
| Password manager vault | R | Not yet confirmed to exist |

## 5. Third parties holding our data

Maintained in [04-sub-processors.md](04-sub-processors.md).

## 6. Records the ISMS itself produces

Risk register, SoA, sub-processor list, policies, and the evidence list at the end of `isms-policies.md`. None of the people records (access reviews, training, screening, incidents, restore tests) exist yet.

## Open items

- Confirm the row for each of the 46 modules against its migration before audit (this list groups them; an auditor will sample).
- Add data flow diagram (web, mobile, API, worker, ai, outbound hosts) in the next version.
- Decide where this inventory lives long-term (this file, or a GRC tool if one is bought).
