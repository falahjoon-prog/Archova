# Sub-processor and supplier register (v1, 21 Nov 2026)

Owner: Sam, with Grace for privacy. Supports APP 8 (cross-border disclosure, doc 08 §3), policy P8, and customer DPAs. Not legal advice; a lawyer must review before it is published to customers (Grace D1).

**Rules (P8):** no supplier touches customer data before a security review, signed DPA and a row here. Customers get notice of a new sub-processor before use (30 days for Enterprise). No AI vendor outside the `ai` module or outside Australia (X25/X26).

"State" says whether it is used in code today: **Live in code** (integration exists in this repo), **Designed** (infra or docs specify it, nothing running), **Planned** (no code), **Pilot only**. "DPA" is **Not recorded** for every row: no signed agreements are on file in this repo, and none are claimed here.

## A. Sub-processors that process customer data

| Supplier | Purpose | Customer data sent | Region | State | DPA / review | Residency note |
|---|---|---|---|---|---|---|
| Amazon Web Services (AWS) | Hosting: compute (ECS), Aurora Postgres, S3, Valkey, KMS, Secrets Manager, CloudFront/WAF, backups, logs | All tenant data | ap-southeast-2 Sydney; DR ap-southeast-4 Melbourne (SCP denies other regions) | Designed (not applied) | AWS DPA not recorded; AWS Artifact reports to collect | Onshore. Global edge: CloudFront serves cached content from edge locations; confirm cache of non-public content is off or AU-only |
| AWS Bedrock | LLM inference for Nova, via the `ai` module only | Prompts and context from the tenant's own data | AU inference profile (Sydney + Melbourne) | Live in code (`modules/ai/src/infra/providers/bedrock.ts`) | Part of AWS DPA | Onshore only. If a model is unavailable in AU, it is not used or the cross-border use is disclosed (doc 08 §3). Customer prompts not used for training |
| AWS Textract | OCR of uploaded documents | Document images | ap-southeast-2 | Live in code (`providers/textract.ts`) | Part of AWS DPA | Onshore |
| AWS Transcribe | Voice input to text | Audio clips | ap-southeast-2 | Live in code (`providers/transcribe.ts`) | Part of AWS DPA | Onshore; confirm audio is not retained |
| Amazon SES | Transactional email out, inbound email-in (X48) | Recipient addresses, message content, attachments | Sydney (sending); receiving in Sydney or own MX on ECS | Live in code (`apps/worker/src/email.ts`); inbound Designed | Part of AWS DPA | Onshore for sending; confirm SES receiving region before turning on email-in |
| Twilio | SMS (notifications, sign-in prompts) | Mobile number, message text | Twilio `au1` region by default in code (`apps/worker/src/sms.ts`) | Live in code, no account recorded | Not recorded | Twilio Inc. is a US company; messages route via carriers. Disclose as overseas recipient under APP 8 unless Twilio's AU data residency terms are confirmed |
| Stripe | Subscription billing and card payments | Billing contact, org identifier, plan; card data entered on Stripe, never held by us | Stripe (US/global); data stays at Stripe | Designed: `api.stripe.com` is in the egress allow-list; no Stripe code in `modules/billing/src` yet | Not recorded; Stripe's DPA to sign | Offshore. Disclose per APP 8. **Payments review gate:** a dedicated security review before any payment PR merges and no live keys before a penetration test (project rule) |

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
| Sentry | Web and mobile crash reports | IDs, stack traces; PII scrubbing designed (no bodies, names or emails) | US/EU per infra/05 | **Planned: no Sentry SDK in the repo yet** | Offshore. Residency risk R-22: prefer an AU option or self-host in Sydney; scrub tests before enabling |
| PagerDuty (or incident.io, undecided) | Alert paging | Alert text, service names | US/global | Planned | Keep alerts free of personal data |
| External uptime monitor | Synthetic checks from outside AWS | Public URLs only | Vendor choice | Planned | Pick a vendor; no tenant data |
| Expo (EAS, push), Apple APNs, Google FCM | Mobile builds and push notifications | Push token, notification text | US/global | Egress allow-list mentions them; EAS build profiles exist; push code not found | Offshore; keep notification text generic or disclose |
| Cloudflare | **Pilot only**: quick tunnel for the demo on John's PC | All demo traffic, including login, passes through Cloudflare | US company, global network | Pilot only (laptop-demo doc) | Sample data only; must not carry customer data; not in production design (R-03). Production uses CloudFront. Audit gap 3 |
| Linode (Akamai) | Alternative host if John picks it | As AWS row | Sydney, Melbourne backup | Designed (`infra/envs/linode-pilot`), not applied | Becomes Section A if chosen |
| ABR ABN Lookup (`abr.business.gov.au`) | Validate ABNs | ABN or name (public data) | Australian Government | Live in code allow-list; adapter X44 | Public register; GUID kept in Secrets Manager |
| Bureau of Meteorology feed | Weather for diaries | Site coordinates | Australia | Designed (X44) | Paid subscription not set up; host not yet confirmed |

## D. Staff and development tools (not customer-data processors by policy)

| Supplier | Purpose | Note |
|---|---|---|
| GitHub (Microsoft) | Source, PRs, Actions CI | Private repo; US. No customer data; sample data only (P3). Secrets scanned by gitleaks |
| Google Workspace | Staff email and docs | Staff and business data; DPA through Google terms |
| Anthropic and other AI coding tools | Developer assistance on code and sample data | Allowed by P10 on source and sample data only, never customer data or secrets |
| Password manager | Staff secrets | Vendor not yet chosen or confirmed |

## What we tell customers (draft for lawyer review)

"Customer data is hosted in Amazon Web Services in Sydney with backups in Melbourne, and AI processing stays in Australia. A small number of suppliers outside Australia may receive limited data: Stripe (billing), Twilio (SMS), and, once enabled, crash reporting and push services. We list them here, with what they receive, and give 30 days' notice before adding a sub-processor." Do not publish until the pilot tunnel is gone and the Sentry and Twilio rows are resolved.

## Actions to make this register true

1. Sign or collect DPAs: AWS, Stripe, Twilio (then any chosen crash/paging vendor). John signs. Owner: Sam, Grace reviews.
2. Decide Sentry versus an AU option (R-22). Owner: Jeff.
3. Confirm Twilio AU residency terms or disclose as offshore. Owner: Grace.
4. Confirm CloudFront caching of non-public content. Owner: Jeff.
5. Annual supplier review with a dated record; first review once production is live. Owner: Sam.
6. Customer notice process for sub-processor changes (30 days, Enterprise). Owner: Grace.

## Change log

v1 21 Nov 2026: first register from code and infra allow-lists in `main` (after PR #635).
