# Infrastructure and DevOps

**Owner:** Jeff (DevOps and Infrastructure) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026
**Builds on:** [architecture overview](../architecture/overview.md) and [cross-team decisions](../architecture/cross-team-decisions.md) (Ava), [backend design](../backend/README.md) (Ben), [plan](../../plans/plan.md)

Documentation only, no code yet. This folder describes where the platform runs, how code gets from a pull request to production, how it scales to 100,000+ users, how we know it is healthy, how we recover when it is not, and what it costs.

Where this folder and [Ava's architecture docs](../architecture/) disagree, Ava's **Decisions** win. Items raised from this folder were settled in [cross-team decisions](../architecture/cross-team-decisions.md) X2, X16–X20 and are reflected here. (Ava's overview lists `docs/devops/` as this area's folder; the coordinator assigned `docs/infrastructure/`, which is what is used here.)

## Documents

| # | Document | Covers |
|---|---|---|
| 1 | [01-cloud-setup.md](01-cloud-setup.md) | AWS accounts, regions and data residency, network, every managed service we use and how it is configured, infrastructure as code |
| 2 | [02-environments.md](02-environments.md) | Local, preview, dev, staging, production, load-test; what differs between them; data and secrets per environment |
| 3 | [03-ci-cd.md](03-ci-cd.md) | Pipelines for API, web, workers, mobile and infrastructure; release strategy, database migrations, feature flags, rollback |
| 4 | [04-scaling-and-load.md](04-scaling-and-load.md) | Load model for 100k+ users, capacity per tier, autoscaling rules, SLOs, load-testing plan, cells |
| 5 | [05-observability.md](05-observability.md) | Logs, metrics, traces, dashboards, alerts, on-call and incident process |
| 6 | [06-backup-and-dr.md](06-backup-and-dr.md) | Backups, retention, immutability, RPO/RTO, disaster recovery to Melbourne, restore drills |
| 7 | [07-cost-estimates.md](07-cost-estimates.md) | Monthly AWS, tooling and AI cost at pilot, 10k and 100k users (AI from Ari's model); cost controls |
| 8 | [08-runbooks-index.md](08-runbooks-index.md) | Runbooks to write before launch, and the operational readiness checklist |

## Decisions in one place

| # | Decision | Why |
|---|---|---|
| I1 | **AWS, primary region ap-southeast-2 (Sydney), DR region ap-southeast-4 (Melbourne).** No customer data leaves Australia. | AU data residency is a selling point for builders and government clients; Melbourne gives an in-country second region. |
| I2 | **AWS Organizations + Control Tower**, one account per environment plus security, log archive, shared services and backup accounts. | Blast-radius isolation; production credentials never exist in dev. |
| I3 | **Terraform (OpenTofu-compatible)** for all infrastructure, in `infra/` in the monorepo. No click-ops in staging or prod. | One tool across AWS, Cloudflare/DNS, GitHub and monitoring vendors; reviewable plans in PRs. |
| I4 | **ECS on Fargate** for every service (web, api, workers, realtime). No Kubernetes until a concrete need appears. | Matches Ava's D12; far less to operate than EKS for a small team, and comfortably handles 100k users. |
| I5 | **Aurora PostgreSQL 16** (Multi-AZ, 1 writer + readers), **ElastiCache for Valkey** (BullMQ jobs and domain events), **S3**, **OpenSearch Service**. Browser uses `app.<domain>` only; mobile and public API use `api.<domain>` (ADR-0004). | Managed versions of the stores Ava chose (D6). |
| I6 | **GitHub Actions with OIDC to AWS**, images in ECR, deploys via ECS blue/green. Mobile builds on **Expo EAS**. | No long-lived cloud keys; safe, instant rollback. |
| I7 | **Observability stays in AU:** OpenTelemetry → CloudWatch, Amazon Managed Prometheus, Amazon Managed Grafana, X-Ray. | Logs and traces contain customer data; keeping them in Sydney keeps the residency story simple. |
| I8 | **SLO: 99.9% monthly availability** for the API and web app; RPO ~0 / RTO < 5 min for an AZ loss; for a full region loss, RPO and RTO ≤ 24 h in phases 0–2, then RPO < 1 min / RTO ≤ 4 h from phase 3 when payment claims go live. | Realistic for a B2B SaaS at this stage; SOPA deadlines mean outages during business hours hurt. |
| I9 | **Backups in a separate, locked backup account** with cross-region copies to Melbourne; audit log exports in S3 Object Lock (compliance mode). | Ransomware and fat-finger protection; claims are legal evidence (plan §2). |
| I10 | **AI egress allow-list and BYO-provider key** (X25, X28): `api` and `ai-worker` run in restricted subnets whose internet egress passes AWS Network Firewall with a domain allow-list of approved Australian AI endpoints only; Bedrock limited to AU models and the AU inference profile by IAM and endpoint policy; BYO AI secrets under a dedicated per-environment KMS key. | Enforces john's rule that no AI data leaves Australia at the network layer, not only in code. Adds ~$1.5k/month across all environments at pilot scale. |
| I11 | **Owner console at `console.<domain>`** (in the prod account, own CloudFront/WAF, ALB OIDC to the staff IdP, `/internal/v1` reachable only from that origin) and **public website + Payload CMS at `www.<domain>`** in a separate `archova-marketing` account with its own small Postgres and S3 in Sydney (X56, X57). | Keeps the staff back door and the marketing site away from customer data and from each other. About $450–650/month together. |

## Assumptions to confirm

1. **Scale target** follows Ava: 100,000 registered users, ~10,000 tenant orgs, ~15,000 peak concurrent users, designed to stretch to 1M by adding cells.
2. **Product name** is Archova (X24): AWS accounts `archova-<env>`, resources `archova-<env>-<cell>-<service>`. The domain is not registered yet, so docs write `<domain>`.
3. **AI provider and AI cost:** Amazon Bedrock in AU, per Ari's [02-models-and-providers.md](../ai/02-models-and-providers.md). AI spend figures come from Ari's [05-cost-control.md](../ai/05-cost-control.md) (about $151k a month at 100k users in the base case); infra hosts the gateway and workers and requests Bedrock quota.
4. **Costs are in USD** at Sydney list prices (roughly 10–20% above US regions), before any savings plans or startup credits. Multiply by ~1.55 for AUD.

## Interfaces with the rest of the team

| Teammate | What infra needs from them | What they get from infra |
|---|---|---|
| Ava | Service list, cell model, SLOs (scaling.md) | Environment and account layout, runtime constraints, cost per architecture choice |
| Ben | Queue list, DB sizing inputs, migration approach, health endpoints | Database, Redis, S3 and OpenSearch provisioning; migration pipeline step |
| Felix | Next.js output mode, build-time env vars | Web hosting on ECS + CloudFront, preview environments per PR |
| Mia | App bundle IDs, OTA policy | EAS build/submit pipeline, store signing key custody |
| Ari | Model choice, expected token volume, vector store needs | Bedrock access in AU, ai-worker scaling, per-tenant cost metering |
| Sam | Security controls, compliance targets (ISO 27001 / SOC 2), key management policy | Guardrails in AWS (SCPs, GuardDuty, Security Hub, KMS), audit evidence, metering for licensing |
| Uma | — | — |
