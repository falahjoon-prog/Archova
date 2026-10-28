# infra

Terraform for Archova on AWS (owner: Jeff). Design: [docs/infrastructure/](../docs/infrastructure/README.md), especially [01-cloud-setup.md](../docs/infrastructure/01-cloud-setup.md). Domain: **archova.com.au**.

Images are built from the root [Dockerfile](../Dockerfile) (targets `api`, `web`, `worker`, `ai-worker`, `migrate`) by [images.yml](../.github/workflows/images.yml), which also scans them, writes an SBOM and, once AWS is ready, pushes and signs them.

Nothing here has been applied. Every stack passes `terraform validate`, `tflint` and `checkov` in CI ([.github/workflows/infra.yml](../.github/workflows/infra.yml)); plans and applies switch on once the AWS accounts exist (see [First-time setup](#first-time-setup)).

```
infra/
├── modules/             reusable building blocks, no environment values
│   ├── network/         VPC, subnet tiers, NAT, Network Firewall egress rules, DNS Firewall, VPC endpoints, flow logs
│   ├── kms-key/         one customer-managed key with the right key policy
│   ├── s3-bucket/       private bucket defaults: BPA, SSE-KMS, versioning, TLS-only, lifecycle, Object Lock
│   ├── aurora/          Aurora PostgreSQL 16, RDS Proxy, one secret per app role
│   ├── valkey/          ElastiCache for Valkey (queue or cache), TLS + AUTH, connection secret
│   ├── ecs-service/     Fargate arm64 service, autoscaling, native ECS blue/green with a 10% canary
│   ├── cloudfront-waf/  app. and api. distributions (ADR-0004) and their WAF web ACLs
│   ├── github-oidc/     GitHub Actions roles, no long-lived keys
│   ├── backup/          AWS Backup plan with copies to the backup account
│   └── observability/   page and ticket topics, the infra alarms from infrastructure/05 §4
├── cells/cell/          one complete stack ("a cell"): composes the modules
├── envs/                one root stack per environment, each with its egress-allowlist.yaml
│   ├── dev/  staging/  prod-cell1/  loadtest/
│   ├── shared-services/ Terraform state, ECR, image-build role, the archova.com.au zone
│   └── linode-pilot/    the Linode option for the pilots (docs/infrastructure/10), not chosen yet
├── org/                 SCPs and tag policy (applied by hand from the management account)
├── .tflint.hcl
└── .checkov.yaml        every skipped check has a reason
```

Resource names: `archova-<env>-<cell>-<service>` (X24). Buckets add the account's last six digits.

## Hosts

| Environment | Browser                      | Mobile and public API        |
| ----------- | ---------------------------- | ---------------------------- |
| prod        | `app.archova.com.au`         | `api.archova.com.au`         |
| staging     | `app.staging.archova.com.au` | `api.staging.archova.com.au` |
| dev         | `app.dev.archova.com.au`     | `api.dev.archova.com.au`     |

`origin.<app host>` is the ALB's name for CloudFront and is not reachable without the secret origin header. `www.` and the Payload CMS site (X57) live in the `archova-marketing` account and `console.` (X56) beside prod; both come in a later PR.

## Egress allow-list (X25, X28)

`api` (and later `ai-worker`) run in the **restricted** subnets. Their only way out is AWS Network Firewall, which passes TLS to the exact hostnames in `envs/<env>/egress-allowlist.yaml` and drops and logs everything else; a drop pages on-call. The private subnets (web, workers) may reach anything except the AI vendor deny-list, and Route 53 DNS Firewall stops every subnet resolving those vendors. Bedrock is reached through a VPC endpoint whose policy allows only Sydney/Melbourne models and the AU inference profile; an SCP says the same org-wide.

To change the list, edit the YAML in each environment and open a PR for Jeff and Sam (and Ari for `kind: ai`). `pnpm check:egress` fails if an AI endpoint outside Australia, a wildcard, or an entry without an owner and reason is added.

## First-time setup

What john (or whoever holds the AWS root login) does once. Nothing here needs a terminal, and nothing costs money
until the first apply. Every later change goes through pull requests and the Infra workflow.

1. **AWS Organization.** Sign up for AWS with a new email address; this first account is the management
   (billing) account. Turn on MFA for the root user, then in **AWS Organizations** choose _Create an organization_.
   Set an **AWS Budgets** alert on the monthly total (the demo is sized for A$500–1,000 a month, see below).
2. **Accounts.** In AWS Organizations, _Add an AWS account_ → _Create an AWS account_, once for each of
   `archova-shared-services` and `archova-demo` (later `archova-dev`, `archova-staging`, `archova-prod`). Each needs
   its own email address. Note each 12-digit account id. Control Tower, the backup account and the `org/` guardrails
   come before pilots hold real data.
3. **Sign-in.** Turn on **IAM Identity Center**, add yourself as a user with MFA, and give that user
   `AdministratorAccess` on every account. Use it from now on instead of the root user.
4. **Let GitHub Actions in.** Sign in to each new account in the Sydney region (ap-southeast-2), open
   **CloudFormation** → _Create stack_ → _Upload a template file_, and choose
   [bootstrap/github-actions.yaml](bootstrap/github-actions.yaml) from this repository. Name the stack
   `archova-github`, set **Environment** to `shared-services` or `demo`, tick the IAM acknowledgement and create it.
   This adds the GitHub sign-in and the plan and apply roles; no keys leave AWS.
5. **GitHub settings** (repository → Settings):
   - _Environments_: create `shared-services-infra`, `demo-infra` and `demo`, each with **john** as required
     reviewer, so nothing is applied or deployed without your click.
   - _Secrets and variables → Actions → Secrets_: `DEMO_PASSWORD`, the password for the demo login
     `demo@archova.com.au` (10+ characters, not containing the email).
   - _Variables_: `AWS_ACCOUNT_SHARED` and `AWS_ACCOUNT_DEMO` (the account ids), then `INFRA_AWS_READY` = `true`.
6. **First run.** Actions → Infra → _Run workflow_ on `main`. Approve `shared-services-infra`: it creates the state
   bucket, the image registry and the `archova.com.au` DNS zone.
7. **Point archova.com.au at AWS.** In the shared-services account open **Route 53** → _Hosted zones_ →
   `archova.com.au` and copy the four `ns-….awsdns-…` name servers. At the registrar where you bought the domain,
   open its DNS or name server settings, choose custom name servers, paste the four names and save. .au changes
   usually take effect within a few hours.
8. **Turn on Nova's models.** In the demo account, Sydney region: **Amazon Bedrock** → _Model access_ → enable
   Claude Haiku 4.5, Claude Sonnet 5, Claude Opus 5.5 and Titan Text Embeddings V2. The cell uses their `au.`
   inference profiles (Ari); check with `aws bedrock list-inference-profiles --region ap-southeast-2`.
9. **Images, then the demo.** Re-run _Images_ on `main` (it pushes the first images), then re-run _Infra_ and
   approve `demo-infra`. The _Deploy_ workflow follows every image build on `main`: approve `demo` and it sets up
   the database roles, runs migrations, deploys, smoke-tests and seeds the sample builder.

Every name the workflows need (roles, state bucket, registry, DNS role) is derived from the account ids, so there
is nothing else to copy. dev, staging and prod follow the same steps with their own account, CloudFormation
**Environment** value, GitHub environments and `AWS_ACCOUNT_*` variable.

## Demo

`envs/demo` runs a working Archova at **demo.archova.com.au** (API on `api.demo.archova.com.au`) for john and pilot
builders to click through. It holds synthetic data only: [tools/demo-seed](../tools/demo-seed) creates the
sample builder _Harbour Line Constructions_ with three projects, companies, folders, documents, published drawing
sets with a superseded sheet, markups, a transmittal and Nova's index, through the public API. Sign in as `demo@archova.com.au` with `DEMO_PASSWORD`.

It is the production design at the smallest size: two AZs (the ALB and Aurora need two), one NAT gateway and
**no egress firewall** (john, 2 Oct 2026: sample data only; Nova is still held in Australia by DNS Firewall, the
Bedrock endpoint policy and task IAM), interface endpoints in one AZ, Aurora Serverless v2 that pauses after an idle hour (the first
click after that waits about 15 seconds), one `cache.t4g.micro` Valkey node, 0.5 vCPU api and web tasks, and a
short blue/green canary.

Estimated monthly cost, Sydney prices, light use (US$; A$ at about 1.55):

| Item                                                                   |                US$/month |
| ---------------------------------------------------------------------- | -----------------------: |
| NAT gateway (one)                                                      |                      ~45 |
| Interface VPC endpoints, 9 in one AZ                                   |                      ~85 |
| Fargate: api and web, 0.5 vCPU / 1 GB each, always on                  |                      ~30 |
| Application Load Balancer                                              |                      ~25 |
| CloudFront and two WAF web ACLs                                        |                      ~25 |
| Aurora Serverless v2, pausing when idle, plus storage                  |                   ~15–40 |
| Valkey `cache.t4g.micro`                                               |                      ~15 |
| KMS keys, Secrets Manager, CloudWatch logs and alarms, Route 53        |                      ~30 |
| shared-services: state, image registry (with Melbourne copy), DNS zone |                      ~10 |
| Nova on Bedrock (light demo use)                                       |                   ~10–50 |
| **Total**                                                              | **~290–355 (A$450–550)** |

With the Network Firewall (as in dev, staging and prod) it would be about US$535–600 (A$830–930).

## Pilot size

`envs/prod-cell1` has two sizes, set with `size` in its tfvars ([09-pilot-hosting-options](../docs/infrastructure/09-pilot-hosting-options.md) §4):

|                         | lean (pilots, default)                                  | full (from the first paying builder) |
| ----------------------- | ------------------------------------------------------- | ------------------------------------ |
| NAT and egress firewall | one of each                                             | one per AZ (three)                   |
| Interface endpoints     | one AZ                                                  | every AZ                             |
| Aurora                  | one Serverless v2 writer (1–8 ACU), no reader, no proxy | r7g.large writer + reader, RDS Proxy |
| Valkey                  | one t4g.small node                                      | split queue and cache, with replicas |
| api / web tasks         | 2 × 0.5 vCPU each                                       | 3 × 1 vCPU each, morning ramp        |
| About, per month        | A$1,300–1,950 before Nova                               | see 07-cost-estimates                |

Both keep WAF blocking, the egress firewall, GuardDuty scanning, 35-day point-in-time restore and backup copies in Sydney and Melbourne. Lean runs in one AZ for NAT and endpoints, so an AZ outage can stop it until the AZ recovers. Changing `size` and applying moves between them with no data move (Aurora adds a reader; check the plan for Valkey, since a rebuilt node starts empty and signs everyone out once).

## Differences from the docs

- **One state file per environment**, not per layer. Deploys never go through Terraform (it ignores task definitions and desired counts), and the database has deletion protection, so a services change can't remove data. Split into layers when a second person applies infra.
- **State locking uses S3 native lock files** (`use_lockfile`), not DynamoDB, which Terraform has deprecated.
- **NAT gateways sit in their own small subnets**, not with the ALB, so ALB-to-task traffic never crosses the firewall.
- **Non-prod DNS zones are delegated to their own accounts**; prod's records go into the apex zone in shared-services through a narrow role.
- **`API_REDIS_URL` points at the queue cluster** (`noeviction`): sessions, revocation markers and Idempotency-Keys must not be evicted. The LRU cache cluster is for disposable caches.
- **`API_TRUST_PROXY=false`**: CloudFront and the ALB pass the viewer Host through, and trusting `X-Forwarded-Host` would let a client pick its own host. Client IPs for rate limits need a trusted-hop setting in the api (Ben).

## Not built yet

| Item                                                                                                                                                                                                                 | Where it lands          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Preview environments per PR, DAST (ZAP baseline) against the demo                                                                                                                                                    | Next PR                 |
| Secret rotation Lambdas for the app roles and Valkey                                                                                                                                                                 | Next PR                 |
| realtime, workers, events-relay, ai-worker, webhook-worker, scheduler services                                                                                                                                       | As each app is built    |
| Melbourne DR: S3 and state replication, KMS replicas, pilot-light network                                                                                                                                            | DR PR, before pilots    |
| Backup account vaults with Vault Lock; log-archive forwarding; CloudFront access logs                                                                                                                                | With the org rollout    |
| Owner console (`console.`), marketing account with Payload CMS (`www.`), SES and email-in (`in.`)                                                                                                                    | Later PRs               |
| files-worker service and role (`archova-<env>-c1-files-worker`): moves THREATS_FOUND uploads to `threats/` (30-day hold), DeleteObjectVersion on `orgs/*/credentials/*` for the 7-day ID-image rule; legal-hold role | With Ben's files worker |

## What the application needs from infra (phase 0)

| Need                 | Detail                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Postgres 16 (Aurora) | Roles `app_migrator` (owns schemas), `app_rw` (API/worker, **no BYPASSRLS**, never an owner), `app_platform`, `app_admin`. Extensions `citext`, `pgcrypto` created by an admin before migrations. RDS Proxy / PgBouncer in transaction mode is safe: tenant context is `SET LOCAL` only.   |
| Migrations           | One-off ECS task: `pnpm db:migrate` as `app_migrator` (`MIGRATOR_DATABASE_URL`), before new code takes traffic.                                                                                                                                                                            |
| Valkey               | `API_REDIS_URL`: session hot copy, revocation markers + pub/sub channel `identity:session-revoked`, Idempotency-Key store.                                                                                                                                                                 |
| S3                   | `<env>-files` bucket (SSE-KMS, Block Public Access, versioning). The API presigns PUTs to `quarantine/{uploadId}` and copies to `orgs/{orgId}/…`. CORS on the bucket must allow `PUT` from `https://app.<domain>` with headers `content-type`, `x-amz-checksum-sha256`.                    |
| Secrets              | `API_JWT_PRIVATE_JWK` (ES256 private JWK; rotate by publishing the next key in JWKS first).                                                                                                                                                                                                |
| Edge (ADR-0004)      | `app.<domain>`: `/v1/*` → api, `/realtime` → realtime, rest → web. `api.<domain>`: `/v1/*`, `/.well-known/*`, `/realtime`. Set `API_APP_ORIGINS=https://app.<domain>`, `API_PUBLIC_HOSTS=api.<domain>`, and forward the viewer `Host` (or `X-Forwarded-Host` with `API_TRUST_PROXY=true`). |
| Health               | `GET /health/live`, `GET /health/ready` (checks Postgres and Valkey).                                                                                                                                                                                                                      |
| Malware scanning     | ClamAV in the files worker. The API refuses to start in production without a scanner.                                                                                                                                                                                                      |
