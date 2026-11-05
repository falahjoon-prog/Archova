# 01 · Cloud setup

**Owner:** Jeff · **Status:** Draft v1 · 2 Oct 2026

## 1. Regions and data residency

| Region | Role | What runs there |
|---|---|---|
| **ap-southeast-2 Sydney** | Primary | Everything: compute, databases, files, search, queues, logs, AI calls |
| **ap-southeast-4 Melbourne** | Disaster recovery | Backup copies, Aurora cross-region replica (from phase 3), S3 replicas, pre-built "pilot light" infra (see [06](06-backup-and-dr.md)) |
| us-east-1 | Global control plane only | CloudFront certificates (ACM), IAM, Route 53 control plane. No customer data. |

**Rule:** customer data (database rows, files, logs, traces, search indexes, AI prompts and outputs, backups) is stored and processed only in Sydney and Melbourne. An organisation-level Service Control Policy (SCP) denies creating resources in any other region except the global services above.

Third-party SaaS that would receive customer data must offer AU hosting or receive scrubbed data only. Current list and residency position:

| Vendor | Use | Residency position |
|---|---|---|
| Amazon Bedrock | LLM calls | AU cross-region inference profile (Sydney + Melbourne) where the chosen model supports it; Ari confirms |
| Amazon SES (Sydney) | Transactional email out; inbound email-in (X48) | Sending in region. Receiving must also be in Australia (see §6 Email) |
| Sentry | Front-end and mobile crash reports | US/EU hosted, so PII scrubbing on the client and server side is mandatory; alternative: self-host later |
| Stripe | Billing (Sam) | Payment data only, no project data |
| Expo EAS | Mobile builds and OTA updates | Holds app bundles, no customer data |
| GitHub | Source, CI | No customer data in repos or CI logs (enforced by secret scanning and test fixtures only) |

## 2. AWS account structure

Managed with AWS Organizations and Control Tower. SSO through IAM Identity Center; nobody has IAM users with long-lived keys.

```
Root (management account — billing and Organizations only, no workloads)
├── Security OU
│   ├── security-tooling     GuardDuty, Security Hub, IAM Access Analyzer, Detective (delegated admin)
│   └── log-archive          Org-wide CloudTrail, Config, VPC flow logs, ALB/CloudFront access logs (S3, Object Lock)
├── Infrastructure OU
│   ├── shared-services      ECR, Terraform state, CI OIDC roles, Route 53 public zones
│   └── backup               AWS Backup vaults (vault lock), cross-region copies
└── Workloads OU
    ├── archova-dev
    ├── archova-staging
    ├── archova-prod         (cell 1; later cells may get their own accounts: archova-prod-c2 …)
    ├── archova-marketing    (public website + Payload CMS, X57; no customer data, no network path to product accounts)
    └── archova-loadtest     (created on demand, torn down after tests)
```

### Guardrails (SCPs and org-wide settings)
- Deny regions other than ap-southeast-2, ap-southeast-4 and global services.
- Deny disabling CloudTrail, GuardDuty, Config, or deleting the log archive bucket.
- Deny root user actions in member accounts.
- Deny creating IAM users or access keys (except a break-glass role in management, alarmed).
- Require IMDSv2, encrypted EBS by default, S3 Block Public Access at account level.
- Tag policy: every resource carries `env`, `service`, `cell`, `owner`, `cost-centre`.

Sam owns the security controls themselves (see `docs/security-licensing/`); this section lists only the account-level mechanics.

### Human access
| Role | Dev | Staging | Prod |
|---|---|---|---|
| Engineer | Admin | Read + deploy via CI | Read-only (no data access) |
| On-call | Admin | Admin | Time-boxed elevated access (1 h, approved, logged) |
| Break-glass | — | — | Management account role, MFA hardware key, alarms on use |

Production database access for support goes through an audited, read-only bastion-less path (SSM Session Manager port forwarding to a read replica, with session recording). No direct internet-facing database endpoints anywhere.

## 3. Network (per environment account)

```
VPC 10.x.0.0/16   (one per environment; prod 10.10.0.0/16, staging 10.20, dev 10.30)
├── 3 Availability Zones (ap-southeast-2a/b/c)
├── Public subnets   /22 ×3   ALB, NAT gateways
├── Firewall subnets /28 ×3   AWS Network Firewall endpoints (one per AZ)
├── Private subnets  /19 ×3   ECS tasks: web, realtime, general workers, webhook-worker
├── Restricted subnets /21 ×3 ECS tasks: api, ai-worker (AI-capable services; allow-list egress only, see §3.1)
└── Data subnets    /22 ×3    Aurora, ElastiCache, OpenSearch  (no route to internet)
```

- **NAT:** one NAT gateway per AZ in prod (AZ-independent egress), one total in dev and staging.
- **VPC endpoints** for S3 and DynamoDB (gateway, free), plus ECR, CloudWatch Logs, Secrets Manager, KMS, STS, Bedrock (interface). This keeps AWS traffic off the NAT, which is both cheaper and tighter.
- **Security groups** are service-to-service: ALB → web/api only; api/workers → Aurora/Redis/OpenSearch only. Nothing else talks to data subnets.
- **Egress path:** private and restricted subnets → Network Firewall endpoint (same AZ) → NAT gateway → internet. AWS waives the NAT gateway hourly and data charges for traffic that has passed through a firewall endpoint, which offsets part of the firewall's cost.
- **Egress control:** outbound traffic from workers to third parties (webhook delivery, integrations such as Xero, MYOB, Microsoft 365 and Google, email) leaves through the NAT with fixed Elastic IPs that customers can allow-list. **Published egress IPs (Leo L3):** the three prod NAT Elastic IPs (one per AZ) are allocated once, never released, and published at `https://<domain>/.well-known/egress-ips.json` and on the docs and trust pages; staging IPs are published separately for customers testing integrations. Webhook and integration workers always leave through these NATs. Adding or changing an IP is announced 30 days ahead. Webhook delivery runs in its own service and subnet so a malicious customer endpoint cannot reach internal services (SSRF protection: deny private ranges at the app layer too).

### 3.1 AI egress allow-list (X25, X28)

John's hard rule (X25) is that no prompt, document, photo or embedding is sent to an AI service outside Australia. The `ai` gateway enforces it in code; the network enforces it again so that a bug, a compromised dependency or a misconfigured BYO provider cannot break it.

**Layer 1: AWS Network Firewall** (per environment VPC, one endpoint per AZ in prod and staging, one in dev)
- A stateful **domain allow-list rule group** (TLS SNI and HTTP Host matching) applied to traffic **from the restricted subnets** (api, ai-worker). Default action for those subnets: **drop and log**. Plain HTTP and non-443 ports out of the restricted subnets are dropped.
- Allowed domains are only what those services genuinely need: approved Australian AI endpoints, plus a short list of non-AI dependencies the API calls (e.g. Stripe API, Sentry ingest, Expo push, APNs/FCM). Each entry has an owner and a reason in `infra/envs/<env>/egress-allowlist.yaml`.
- Non-AI entries on the restricted allow-list (all HTTPS, exact hostnames):

| Endpoint | Used by | Owner | Why |
|---|---|---|---|
| `abr.business.gov.au` | `api` (ABN lookup adapter, X44) | Ben | ABN Lookup web services. The ABR **GUID** is stored in Secrets Manager at `archova/<env>/integrations/abr-guid` and read only by the `api` task role |
| BOM data service host(s) (exact host confirmed when the subscription is set up) | `worker` integrations group (weather adapter, X44) | Ben | Paid BOM observations and rainfall feed; credentials in Secrets Manager at `archova/<env>/integrations/bom`. Not added until the commercial licence is signed (see [07](07-cost-estimates.md)) |
| `identity.xero.com` | `api` OAuth callback | Leo | Xero token exchange (L1) |
| `secure.myob.com` | `api` OAuth callback | Leo | MYOB token exchange |
| `login.microsoftonline.com` | `api` OAuth callback | Leo | Microsoft 365 token exchange |
| `oauth2.googleapis.com` | `api` OAuth callback | Leo | Google Workspace token exchange |

  All other integration data calls (Xero, MYOB, Graph, Google APIs) run in the general `worker` integrations group in the private subnets, not in the restricted subnets, per Leo's design.
- Approved AI endpoints today:

| Endpoint | Path | Why allowed |
|---|---|---|
| `bedrock-runtime.ap-southeast-2.amazonaws.com`, `bedrock-runtime.ap-southeast-4.amazonaws.com` | Normally via our **VPC interface endpoint**, so it never reaches the firewall; listed so a misrouted call still works only in AU | Our default provider (Ari), AU inference profile only |
| `textract.ap-southeast-2.amazonaws.com` | VPC endpoint | OCR (built in) |
| `sts.ap-southeast-2.amazonaws.com` | VPC endpoint | Assume a customer's BYO Bedrock role (X28) |
| `<resource>.openai.azure.com` for a specific enterprise resource in Australia East / Australia Southeast | Firewall allow-list, **one exact hostname per approved connection** | BYO Azure (X28). Added only after Ari and Sam confirm the resource's region is in Australia; wildcard `*.openai.azure.com` is never allowed because it would include non-AU resources |

- Traffic from other private subnets (webhook-worker, general workers) is outside this allow-list: those services never hold AI credentials and have no AI SDK. Their egress is logged, with a deny-list of known AI vendor domains so they cannot be used as a side door.
- Firewall alert and flow logs go to the log-archive account; a page fires on any drop from the restricted subnets to an AI-looking domain (it means code tried to reach a non-approved AI service).

**Layer 2: Bedrock and IAM controls**
- The Bedrock VPC endpoint policy and the task-role IAM policies allow `bedrock:InvokeModel*` only on Sydney/Melbourne foundation models and the **AU cross-region inference profile**; global or US/APAC profiles are explicitly denied. An SCP backs this up org-wide.
- BYO Bedrock: the `ai-worker` and API task roles may `sts:AssumeRole` only into roles named `archova-byo-*` with an `ExternalId` per org; calls made with the customer's credentials still go through our AU-only VPC endpoint.

**Layer 3: DNS** — Route 53 Resolver DNS Firewall on each VPC blocks resolution of known AI vendor domains that are not on the allow-list, and logs all queries from the restricted subnets.

Changes to the allow-list are Terraform PRs reviewed by Jeff and Sam (and Ari for AI endpoints), with a test in CI that fails if any AI domain outside Australia is added.

## 4. Edge and traffic flow

Routing follows Ava's [ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md) (cross-team decision X2): the browser talks to **one origin**, `app.<domain>`, using the `__Host-sid` session cookie; mobile apps and the public API use a **separate origin**, `api.<domain>`, with bearer tokens only.

```
Browser                                   Mobile apps / public API clients
   │                                                 │
Route 53                                          Route 53
   │                                                 │
CloudFront distribution "app" + WAF (web ACL)     CloudFront distribution "api" + WAF (web ACL)
 app.<domain>                                      api.<domain>
   ├── /_next/static/*  → S3 static-web (cached)     ├── /v1/*       → ALB → api      (bearer only)
   ├── /v1/*            → ALB → api      (cookie)    └── /realtime   → ALB → realtime (token in first message)
   ├── /realtime        → ALB → realtime (WebSocket, cookie on upgrade)
   └── /*  (default)    → ALB → web (Next.js SSR)
                         Application Load Balancer (per environment, 3 AZs; host + path rules)
Files: browser/mobile ⇄ S3 directly via presigned PUT (upload) and CloudFront signed URL (download)
```

Edge rules that make the ADR hold:

- **`app.<domain>`**: `/v1/*` and `/realtime` behaviours are never cached and forward the `__Host-sid` cookie and the `Origin` header; the realtime service checks `Origin` on upgrade (X3). The default behaviour forwards cookies to `web`. No CORS is needed because everything is same-origin.
- **`api.<domain>`**: forwards the `Authorization` header and **strips all cookies** at CloudFront, so a browser session can never authenticate a call here. The api service returns no credentialed CORS headers (`Access-Control-Allow-Credentials` is never sent).
- **ALB rules**: host `app.<domain>` + path `/v1/*` → api target group; host `app.<domain>` + path `/realtime` → realtime target group; host `app.<domain>` default → web; host `api.<domain>` + `/v1/*` → api; host `api.<domain>` + `/realtime` → realtime. The ALB only accepts traffic from CloudFront (managed prefix list plus a secret origin header), so nobody can bypass WAF.
- **Separate WAF web ACLs**: the app ACL rate-limits per IP and session; the api ACL rate-limits per IP and per API key, with stricter body-size limits.
- The mobile realtime path (`api.<domain>/realtime`) is my assumption from X3 (mobile sends its token in the first message); Ava to confirm.

- **HSTS** is set at CloudFront, not in the app: `max-age=63072000; includeSubDomains; preload` on the app and api distributions (the tiles CDN uses 31536000). The header preloads nothing by itself. **Manual step, owned by john (Sam):** submitting `archova.com.au` to hstspreload.org is hard to undo, so it is never automated and waits for john's word, and only once every subdomain (staging and `console.` included) is confirmed HTTPS-only, because `includeSubDomains` covers them all.
- Static web assets (`/_next/static`) are served from S3 through CloudFront with long cache lifetimes; only SSR and API traffic reaches the ALB.
- Shield Standard is on by default; Shield Advanced is not needed before enterprise customers ask for it (~USD 3,000/month).
- Custom domains for customers (e.g. `projects.bigbuilder.com.au`) are a later feature; CloudFront supports it with per-tenant ACM certificates.

### 4.1 Owner console and public website (X56, X57, ADR-0008)

| | Owner console | Public website + CMS |
|---|---|---|
| App | `apps/admin` (Next.js) + `backoffice` module in `apps/api` | `apps/site` (Next.js with Payload CMS) |
| Origin | `console.<domain>` | `www.<domain>` (apex `<domain>` redirects here); editor at `www.<domain>/cms` |
| Account | `archova-prod` (and `-staging`, `-dev`), next to the cell it administers | `archova-marketing` (with a staging stack in the same account) |
| Edge | Own CloudFront distribution + its own WAF web ACL: Australia-only geo match (staff abroad use the company VPN), tight rate limits, bot control | CloudFront with long caching (static and ISR pages), WAF managed rules; `/cms*` behaviour uncached, stricter rate limits |
| Routing | `console.<domain>/*` → ALB → `admin` service; `console.<domain>/internal/v1/*` → ALB → `api`. **`/internal/*` is blocked (403) on the `app.` and `api.` distributions and at the ALB unless the request carries the console distribution's secret origin header**, so the backoffice API is reachable only from the console origin | `www.<domain>/*` → ALB → `site` service; media from S3 via CloudFront |
| Staff sign-in | ALB `authenticate-oidc` action against the **staff IdP** in front of every console request (defence in depth), then the app's own staff session with passkey or hardware-key MFA and step-up for money and suspensions (Sam) | `/cms*` gets the same ALB OIDC action against the staff IdP; Payload's own login only accepts users that IdP has asserted |
| Data | No data store of its own: everything goes through `backoffice` and the module interfaces in the product database (normal tenant transactions, no `BYPASSRLS`) | Own small **RDS PostgreSQL 16** (`db.t4g.medium`, Multi-AZ in prod) and S3 media bucket `archova-prod-marketing-media-<acct6>`, both Sydney. No customer data, ever |
| Compute | ECS service `admin` (2 tasks, 0.5 vCPU) | ECS service `site` (2–6 tasks, 1 vCPU), scales on CPU and requests |
| Egress | Private subnets, normal NAT | Private subnets in the marketing VPC; only call to the product is `GET api.<domain>/v1/public/price-book` over the internet like any client |
| Backups | n/a (stateless) | RDS PITR 14 days + daily AWS Backup copy to the backup account and Melbourne (35 days); S3 versioning + replication to Melbourne. RTO 24 h; if the site is down, CloudFront serves a static fallback page from S3 |

**Staff IdP (proposal, Sam to confirm):** the company's workforce identity provider (Microsoft Entra ID or Google Workspace, whichever the company runs its email on), with FIDO2 passkeys or hardware keys enforced and no SMS or push fallback. The same IdP federates into IAM Identity Center for AWS access, so one leaver process removes console, CMS and AWS access together. Staff roles (support, sales, finance, owner, editor) come from IdP groups.

**Later cells:** while there is one cell, the console runs beside it. When cell 2 exists, the console stays in `archova-prod` and calls each cell's `/internal/v1` over private connectivity (VPC Lattice or PrivateLink), using the tenant directory to find the cell.

## 5. Compute: services on ECS Fargate

One ECS cluster per environment. Each row is an ECS service with its own task definition, IAM role, autoscaling policy and log group. Container images are built once and promoted across environments.

| Service | What it runs | Exposed | Notes |
|---|---|---|---|
| `web` | Next.js (standalone output) | `app.<domain>` default route | SSR and the BFF routes only; no domain logic (Felix's doc) |
| `api` | Fastify modular monolith (`apps/api`) | `app.<domain>/v1/*` (cookie) and `api.<domain>/v1/*` (bearer) | Stateless, the bulk of the traffic |
| `realtime` | WebSocket gateway for notifications and presence | `app.<domain>/realtime`, `api.<domain>/realtime` | Fan-out via Redis pub/sub; separate service per ADR-0004 so long-lived connections don't affect API autoscaling |
| `worker` | BullMQ consumers: email, PDF, thumbnails, notifications, SOPA due-date checks | — | Several services from one image, split by queue group so heavy jobs (PDF, drawing tiles) cannot starve light ones (email, notifications) |
| `events-relay` | Transactional outbox → BullMQ on Valkey (X19) | — | Small, 2 tasks for availability |
| `ai-worker` | Embedding, extraction, OCR (Textract), batch LLM calls | — | Scales on queue depth; concurrency capped per tenant to control spend. Bedrock quota (tokens and requests per minute) is requested by Jeff ahead of each phase from Ari's cost model |
| `webhook-worker` | Outbound webhooks to customer endpoints | — | Isolated egress (see §3) |
| `scheduler` | Cron-style triggers (EventBridge Scheduler → queue) | — | No in-process cron, so scaling out never double-fires jobs |

**CPU architecture:** all images built for `linux/arm64` (Graviton), about 20% cheaper than x86 for the same work. CI builds multi-arch only if a dependency forces it.

**Heavy file processing** (virus scanning, rasterising large drawing sets into tiles, OCR) runs as Fargate tasks with larger memory (up to 30 GB), or as AWS Batch on Spot if volumes get large. Virus scanning uses Amazon GuardDuty Malware Protection for S3 on the upload bucket.

## 6. Data stores

| Store | Service | Prod configuration (cell 1, day one) | Notes |
|---|---|---|---|
| Relational | **Aurora PostgreSQL 16**, I/O-Optimized | 1 writer + 1 reader, `db.r7g.large`, Multi-AZ; scale per [04](04-scaling-and-load.md) | RLS for tenancy (Ava D5). pgvector extension enabled. Connections pooled through **RDS Proxy** (transaction-scoped `SET LOCAL` for tenant context so proxy pinning is avoided; confirmed in X20, session-level `SET` banned). Storage encrypted with a customer-managed KMS key. |
| Cache, queues, domain events | **ElastiCache for Valkey** (Redis-compatible; BullMQ carries jobs and domain events through phase 3 per X19, SNS/SQS only if replay or fan-out needs grow) | Cluster mode disabled for BullMQ, primary + replica across AZs, Multi-AZ failover; `cache.t4g.medium` for pilots, `cache.r7g.large` from ~1k users | Separate clusters for queues (`noeviction`) and cache (`allkeys-lru`) so cache pressure never drops jobs |
| Files | **S3** | Buckets: `uploads` (quarantine), `files` (clean), `exports`, `static-web`, `audit-archive` (Object Lock), `claims-evidence` (Object Lock, 10 years) | Versioning on, SSE-KMS, Intelligent-Tiering for files older than 30 days, replication to Melbourne (see [06](06-backup-and-dr.md)) |
| Search | **OpenSearch Service** | Introduced when Postgres full-text runs out (Ben's doc); start 3 × `r7g.large.search` data nodes across 3 AZs, 3 dedicated masters at scale | Index per cell, tenant filter enforced in the query layer |
| Secrets | **Secrets Manager** | Database credentials rotated automatically every 30 days | Apps read secrets at start-up through the ECS secrets integration; never in env files or images |
| Config / flags | **AWS AppConfig** | Feature flags and runtime config, per environment | In region; see [03](03-ci-cd.md#feature-flags) |
| Email (outbound) | **SES** (Sydney) | Dedicated IPs once volume > 100k emails/day; DKIM, SPF, DMARC on the sending domain | Bounce and complaint handling to a queue Ben consumes |
| Email (inbound, email-in, X48) | **SES receiving in ap-southeast-2**, if AWS lists Sydney as a receiving region when we build it; otherwise **our own MX on ECS in Sydney** | SES path: MX `in.<domain>` → SES receipt rule set per environment → encrypted S3 bucket `archova-<env>-c1-inbound-mail` → queue for the `integrations` worker. Fallback: a Postfix/Haraka-style MTA as an ECS service behind a Network Load Balancer (port 25, TLS required, 2+ tasks across AZs), writing raw messages to the same S3 bucket. **Rule: mail is never received or relayed through any region outside Australia**, so if Sydney receiving is not available we build the MX rather than use another SES region | I couldn't confirm Sydney receiving from here; it's the first check in phase 1 (runbook in [08](08-runbooks-index.md)). Leo owns parsing and matching ([integrations/05](../integrations/05-email-in.md)) |
| Keys | **KMS** | One customer-managed key per data class (db, files, backups, logs) per environment; pooled tenants use `org_id` as KMS encryption context, dedicated-cell tenants get their own key (X21) | Key id stored per org so a tenant can move to its own key |
| BYO AI provider secrets | **Secrets Manager + dedicated KMS key** `alias/archova-<env>-ai-provider-secrets` (X28) | One key **per environment** (not per org), used for nothing else. Secret path `archova/<env>/orgs/{orgId}/ai-provider`, encryption context `org_id`. Key policy: only the `api` and `ai-worker` task roles may `kms:Decrypt`, and only via Secrets Manager (`kms:ViaService`); administrators can manage but not decrypt. Multi-Region key replica and secret replicas in Melbourne for DR. CloudTrail alarm on any decrypt by another principal. Dedicated-cell tenants use their own key | Ari and Ben own the `ai.provider_connections` table that points at these secrets |

## 7. Infrastructure as code

- **Tool:** Terraform (code kept compatible with OpenTofu so we are not tied to one licence).
- **Location:** `infra/` at the monorepo root (Ava's repo-structure doc should list it):

```
infra/
├── modules/                 # reusable building blocks, no environment values
│   ├── network/  ecs-service/  aurora/  elasticache/  s3-bucket/  opensearch/
│   ├── cloudfront-waf/  observability/  backup/  github-oidc/
├── cells/
│   └── cell/                # composes modules into one complete stack ("a cell")
├── envs/
│   ├── dev/  staging/  prod-cell1/  loadtest/
├── org/                     # accounts, SCPs, Identity Center, Control Tower customisations
└── README.md
```

- **State:** S3 backend in `shared-services` with DynamoDB locking, one state file per environment and per stack layer (org, network, data, services), so a bad apply of services cannot touch the database stack.
- **Workflow:** every infra change is a PR. CI runs `fmt`, `validate`, `tflint`, `checkov` (policy scan) and posts the `plan` to the PR. Apply to dev on merge; staging and prod apply through a protected GitHub environment with approval. See [03](03-ci-cd.md#infrastructure-pipeline).
- **Drift:** nightly `plan` against each environment; any drift opens an issue.
- **A cell is one module call.** Standing up cell 2 (for an enterprise or government tenant, or a NZ region later) is a new `envs/` folder and a new account, not new code.

## 8. Naming and tagging

AWS resources are named `archova-<env>-<cell>-<service>` (cross-team decision X24), e.g. `archova-prod-c1-api`, `archova-staging-c1-aurora`, `archova-dev-c1-worker-pdf`. Cells are `c1`, `c2` …; shared, non-cell resources use `shared` in the cell position (e.g. `archova-prod-shared-ecr`). AWS accounts are `archova-<env>`. S3 bucket names are global, so they add the account's short id: `archova-<env>-<cell>-<purpose>-<acct6>` (e.g. `archova-prod-c1-files-a1b2c3`). Domains use `<domain>` until it is registered. Tags as in §2 guardrails; `cost-centre` maps to the module or feature so AI and file-processing spend can be tracked separately (see [07](07-cost-estimates.md)).
