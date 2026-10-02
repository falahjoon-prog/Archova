# 01 · Cloud setup

**Owner:** Owen · **Status:** Draft v1 · 2 Oct 2026

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
| Amazon SES (Sydney) | Transactional email | In region (preferred over Postmark, which is US/EU hosted) |
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
├── Public subnets  /22 ×3    ALB, NAT gateways
├── Private subnets /19 ×3    ECS tasks (web, api, workers, realtime)
└── Data subnets    /22 ×3    Aurora, ElastiCache, OpenSearch  (no route to internet)
```

- **NAT:** one NAT gateway per AZ in prod (AZ-independent egress), one total in dev and staging.
- **VPC endpoints** for S3 and DynamoDB (gateway, free), plus ECR, CloudWatch Logs, Secrets Manager, KMS, STS, Bedrock (interface). This keeps AWS traffic off the NAT, which is both cheaper and tighter.
- **Security groups** are service-to-service: ALB → web/api only; api/workers → Aurora/Redis/OpenSearch only. Nothing else talks to data subnets.
- **Egress control:** outbound traffic from workers to third parties (webhook delivery, email, Xero/MYOB later) leaves through the NAT with fixed Elastic IPs that customers can allow-list. Webhook delivery runs in its own service and subnet so a malicious customer endpoint cannot reach internal services (SSRF protection: deny private ranges at the app layer too).

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

- Static web assets (`/_next/static`) are served from S3 through CloudFront with long cache lifetimes; only SSR and API traffic reaches the ALB.
- Shield Standard is on by default; Shield Advanced is not needed before enterprise customers ask for it (~USD 3,000/month).
- Custom domains for customers (e.g. `projects.bigbuilder.com.au`) are a later feature; CloudFront supports it with per-tenant ACM certificates.

## 5. Compute: services on ECS Fargate

One ECS cluster per environment. Each row is an ECS service with its own task definition, IAM role, autoscaling policy and log group. Container images are built once and promoted across environments.

| Service | What it runs | Exposed | Notes |
|---|---|---|---|
| `web` | Next.js (standalone output) | `app.<domain>` default route | SSR and the BFF routes only; no domain logic (Felix's doc) |
| `api` | Fastify modular monolith (`apps/api`) | `app.<domain>/v1/*` (cookie) and `api.<domain>/v1/*` (bearer) | Stateless, the bulk of the traffic |
| `realtime` | WebSocket gateway for notifications and presence | `app.<domain>/realtime`, `api.<domain>/realtime` | Fan-out via Redis pub/sub; separate service per ADR-0004 so long-lived connections don't affect API autoscaling |
| `worker` | BullMQ consumers: email, PDF, thumbnails, notifications, SOPA due-date checks | — | Several services from one image, split by queue group so heavy jobs (PDF, drawing tiles) cannot starve light ones (email, notifications) |
| `events-relay` | Transactional outbox → BullMQ on Valkey (X19) | — | Small, 2 tasks for availability |
| `ai-worker` | Embedding, extraction, OCR (Textract), batch LLM calls | — | Scales on queue depth; concurrency capped per tenant to control spend. Bedrock quota (tokens and requests per minute) is requested by Owen ahead of each phase from Ari's cost model |
| `webhook-worker` | Outbound webhooks to customer endpoints | — | Isolated egress (see §3) |
| `scheduler` | Cron-style triggers (EventBridge Scheduler → queue) | — | No in-process cron, so scaling out never double-fires jobs |

**CPU architecture:** all images built for `linux/arm64` (Graviton), about 20% cheaper than x86 for the same work. CI builds multi-arch only if a dependency forces it.

**Heavy file processing** (virus scanning, rasterising large drawing sets into tiles, OCR) runs as Fargate tasks with larger memory (up to 30 GB), or as AWS Batch on Spot if volumes get large. Virus scanning uses Amazon GuardDuty Malware Protection for S3 on the upload bucket.

## 6. Data stores

| Store | Service | Prod configuration (cell 1, day one) | Notes |
|---|---|---|---|
| Relational | **Aurora PostgreSQL 16**, I/O-Optimized | 1 writer + 1 reader, `db.r7g.large`, Multi-AZ; scale per [04](04-scaling-and-load.md) | RLS for tenancy (Ava D5). pgvector extension enabled. Connections pooled through **RDS Proxy** (transaction-scoped `SET LOCAL` for tenant context so proxy pinning is avoided; confirmed in X20, session-level `SET` banned). Storage encrypted with a customer-managed KMS key. |
| Cache, queues, domain events | **ElastiCache for Valkey** (Redis-compatible; BullMQ carries jobs and domain events through phase 3 per X19, SNS/SQS only if replay or fan-out needs grow) | Cluster mode disabled for BullMQ, primary + replica across AZs, Multi-AZ failover; `cache.t4g.medium` for pilots, `cache.r7g.large` from ~1k users | Separate clusters for queues (`noeviction`) and cache (`allkeys-lru`) so cache pressure never drops jobs |
| Files | **S3** | Buckets: `uploads` (quarantine), `files` (clean), `exports`, `static-web`, `audit-archive` (Object Lock) | Versioning on, SSE-KMS, Intelligent-Tiering for files older than 30 days, replication to Melbourne (see [06](06-backup-and-dr.md)) |
| Search | **OpenSearch Service** | Introduced when Postgres full-text runs out (Ben's doc); start 3 × `r7g.large.search` data nodes across 3 AZs, 3 dedicated masters at scale | Index per cell, tenant filter enforced in the query layer |
| Secrets | **Secrets Manager** | Database credentials rotated automatically every 30 days | Apps read secrets at start-up through the ECS secrets integration; never in env files or images |
| Config / flags | **AWS AppConfig** | Feature flags and runtime config, per environment | In region; see [03](03-ci-cd.md#feature-flags) |
| Email | **SES** (Sydney) | Dedicated IPs once volume > 100k emails/day; DKIM, SPF, DMARC on the sending domain | Bounce and complaint handling to a queue Ben consumes |
| Keys | **KMS** | One customer-managed key per data class (db, files, backups, logs) per environment | Enables per-tenant keys later if an enterprise asks (envelope encryption) |

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
