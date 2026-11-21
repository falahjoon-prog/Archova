# Sub-processor and supplier register (v1, 21 Nov 2026)

Owner: Sam, with Grace for privacy. Supports APP 8 (cross-border disclosure, doc 08 §3), policy P8, and customer DPAs. Not legal advice; a lawyer must review before it is published to customers (Grace D1).

**Rules (P8):** no supplier touches customer data before a security review, signed DPA and a row here. Customers get 30 days' notice of a new sub-processor before use, with a right to object (all tiers; to be settled in the DPA). No AI vendor outside the `ai` module or outside Australia (X25/X26).

"State" says whether it is used in code today: **Live in code** (integration exists in this repo), **Designed** (infra or docs specify it, nothing running), **Planned** (no code), **Pilot only**. "DPA" is **Not recorded** for every row: no signed agreements are on file in this repo, and none are claimed here.

## A. Sub-processors that process customer data

| Supplier | Purpose | Customer data sent | Region | State | DPA / review | Residency note |
|---|---|---|---|---|---|---|
| Amazon Web Services (AWS) | Hosting: compute (ECS), Aurora Postgres, S3, Valkey (Redis-compatible cache), KMS, Secrets Manager, CloudFront/WAF, backups, logs | All tenant data | ap-southeast-2 Sydney; DR ap-southeast-4 Melbourne (SCP denies other regions) | Designed (not applied) | AWS DPA not recorded; AWS Artifact reports to collect | Onshore. Global edge: CloudFront serves cached content from edge locations; confirm cache of non-public content is off or AU-only |
| AWS Bedrock | LLM inference for Nova, via the `ai` module only | Prompts and context from the tenant's own data | AU inference profile (Sydney + Melbourne) | Live in code (`modules/ai/src/infra/providers/bedrock.ts`) | Part of AWS DPA | Intended onshore only; not assertable until production exists (R-02). If a model is unavailable in AU it is not used or the cross-border use is disclosed (doc 08 §3). Model providers are understood not to receive prompts: verify against AWS terms. No training on customer data |
| AWS Textract | OCR of uploaded documents | Document images | ap-southeast-2 | Live in code (`providers/textract.ts`) | Part of AWS DPA | Onshore |
| AWS Transcribe | Voice input to text | Audio clips | ap-southeast-2 | Live in code (`providers/transcribe.ts`) | Part of AWS DPA | Onshore; confirm audio is not retained |
| Amazon SES | Transactional email out, inbound email-in (X48) | Recipient addresses, message content, attachments | Sydney (sending); receiving in Sydney or own MX on ECS | Live in code (`apps/worker/src/email.ts`); inbound Designed | Part of AWS DPA | Onshore for sending; confirm SES receiving region before turning on email-in |
| Twilio | SMS (notifications, sign-in prompts) | Mobile number, message text | Twilio `au1` region by default in code (`apps/worker/src/sms.ts`) | Live in code, no account recorded | Not recorded | **Treat as offshore (United States)** and disclose under APP 8 until Twilio confirms in writing which data is stored in AU; do not claim AU residency. SMS payloads must be generic: no names, health or incident detail |
| Stripe | Subscription billing and card payments | Billing contact, org identifier, plan; card data entered on Stripe, never held by us | Stripe (United States, global); data stays at Stripe | Designed: `api.stripe.com` is in the egress allow-list; no Stripe code in `modules/billing/src` yet | Not recorded; Stripe's DPA to sign | Offshore. Disclose per APP 8. **Payments review gate:** a dedicated security review before any payment PR merges and no live keys before a penetration test (project rule) |

## B. Customer-directed integrations

The customer connects these themselves (OAuth). We store the tokens and send or fetch only what the customer enables. Each is the customer's own supplier; we list them so the DPA and privacy policy can describe the data flow.

| Service | Purpose | Data exchanged | Region | State |
|---|---|---|---|---|
| Xero | Accounting sync (`identity.xero.com`, `api.xero.com`) | Invoices, contacts, cost data | Xero AU/NZ | Live in code (web accounting feature, integrations module) |
| MYOB | Accounting sync (`secure.myob.com`, `api.myob.com`) | Invoices, contacts, cost data | MYOB AU | Live in code |
| Google Drive | Folder sync (scope `drive.file`) | Project files the customer chooses | Google (global) | Live in code (`modules/integrations/src/domain/folders/drive.ts`) |
| Microsoft login (`login.microsoftonline.com`) | Single sign-on / folders | Identity assertions | Microsoft | In egress allow-list; confirm what is built |
| Customer's own AWS Bedrock (BYO AI, Enterprise, X28) | Inference with the customer's own account | Prompts | Must be AU | Designed; Enterprise only |

## C. Operational suppliers (usually no customer content)

| Supplier | Purpose | Data | Region | State | Note |
|---|---|---|---|---|---|
| Sentry | Web and mobile crash reports | IDs, stack traces; PII scrubbing designed (no bodies, names or emails) | United States or EU (country to confirm); no AU region known, to verify | **Planned: no Sentry SDK in the repo yet** | Offshore. R-22: self-host in Sydney or do not enable unless an AU region is verified; scrub tests before enabling |
| PagerDuty (or incident.io, undecided) | Alert paging | Alert text, service names | United States / global | Planned | Keep alerts free of personal data |
| External uptime monitor | Synthetic checks from outside AWS | Public URLs only | Vendor choice | Planned | Pick a vendor; no tenant data |
| Expo (EAS, push), Apple APNs, Google FCM | Mobile builds and push notifications | Push token, notification text | United States / global | Egress allow-list mentions them; EAS build profiles exist; push code not found | Offshore (United States). Push payloads must be generic: no names, health or incident detail |
| Cloudflare | **Pilot only**: quick tunnel for the demo on John's PC | All demo traffic, including login, passes through Cloudflare | US company, global network | Pilot only (laptop-demo doc) | If real customers log in during the pilot this is a cross-border disclosure (United States) and must be covered in the pilot agreement; otherwise sample data only; not in production design (R-03). Production uses CloudFront. Audit gap 3 |
| Linode (Akamai) | Alternative host if John picks it | As AWS row | Sydney, Melbourne backup | Designed (`infra/envs/linode-pilot`), not applied | Becomes Section A if chosen |
| ABR ABN Lookup (`abr.business.gov.au`) | Validate ABNs | ABN or name (public data) | Australian Government | Live in code allow-list; adapter X44 | Public register; GUID kept in Secrets Manager |
| Bureau of Meteorology feed | Weather for diaries | Site coordinates | Australia | Designed (X44) | Paid subscription not set up; host not yet confirmed |

## D. Staff and development tools (not customer-data processors by policy)

| Supplier | Purpose | Note |
|---|---|---|
| Self-hosted CI runner host (John's PC, WSL2, when `CI_RUNNER` is set) | Runs CI jobs for every PR, including agent-authored branches | Not a vendor, but an unmanaged host with repo secrets and personal data; R-29. Move to hosted or ephemeral runners |
| GitHub Actions artifacts and caches | Build outputs, test reports, logs | Stored by GitHub (US); must contain no customer data or secrets; set short retention |
| GitHub (Microsoft) | Source, PRs, Actions CI | Private repo; US. No customer data; sample data only (P3). Secrets scanned by gitleaks |
| Google Workspace | Staff email and docs | Staff and business data; DPA through Google terms |
| Anthropic and other AI coding tools | Developer assistance on code and sample data | Allowed by P10 on source and sample data only, never customer data or secrets |
| Password manager | Staff secrets | Vendor not yet chosen or confirmed |

## What we tell customers (draft for lawyer review)

"Our production design hosts customer data in Amazon Web Services in Sydney with backups in Melbourne, and AI processing is designed to stay in Australia (to be stated as fact only once production is live). A small number of suppliers outside Australia may receive limited data: Stripe (United States, billing), Twilio (United States, SMS), and, once enabled, crash reporting and push services. We list them with their countries and what they receive, and give 30 days' notice before adding a sub-processor." Do not publish until the AWS production environment exists (R-02), the pilot tunnel is gone and the Sentry and Twilio rows are resolved.

## Actions to make this register true

1. Sign or collect DPAs: AWS, Stripe, Twilio (then any chosen crash/paging vendor). John signs. Owner: Sam, Grace reviews.
2. Decide Sentry versus an AU option (R-22). Owner: Jeff.
3. Treat Twilio as offshore until written confirmation of AU storage. Owner: Grace.
4. CloudFront: authenticated or non-public content must not be edge-cached: origin sends `Cache-Control: private, no-store`, TTL 0 on authenticated paths, files served by S3 presigned URLs from Sydney, only static public assets cached; price class does not strictly limit edge locations. Whether edge caching is an APP 8 disclosure is a lawyer question. Owner: Jeff, lawyer.
5. Annual supplier review with a dated record; first review once production is live. Owner: Sam.
6. Customer notice process for sub-processor changes (30 days, all tiers). Owner: Grace.

## Change log

v1 21 Nov 2026: first register from code and infra allow-lists in `main` (after PR #635).

## DPA outline (for a lawyer to draft; not legal advice)

Roles (builder as controller-equivalent, Archova as service provider); instructions and confidentiality; APP 11 security measures; sub-processor list with 30 days' notice and an objection right; AU hosting with named countries for offshore suppliers; breach notice to the customer within 72 hours with the NDB notifier allocation; help with APP 12/13 requests; return or deletion at end, with the evidence and legal-hold exception (10 years); AI terms (no training on customer data, AU only); audit rights and ISO evidence.
