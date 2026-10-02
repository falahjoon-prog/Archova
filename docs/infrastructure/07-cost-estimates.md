# 07 · Cost estimates

**Owner:** Owen · **Status:** Draft v1 · 2 Oct 2026

Monthly running costs in **USD at AWS Sydney on-demand list prices** (Sydney is roughly 10–25% dearer than US regions), before savings plans, reserved instances, credits or negotiated discounts. Multiply by about **1.55 for AUD**. These are planning estimates from the load model in [04](04-scaling-and-load.md), accurate to perhaps ±30%; they should be re-checked in the AWS Pricing Calculator once the first load test gives real per-task throughput, and replaced with actuals after the first month in production.

People costs (the team) are not included.

## 1. Summary

AI figures are taken from Ari's model in [docs/ai/05-cost-control.md](../ai/05-cost-control.md) (base case **$1.51 per registered user per month**, range $0.57–2.94, target ≤ $1.00), which is the source of truth for AI spend. They include model calls, embeddings and Textract OCR. Ari's numbers use Anthropic first-party prices; Bedrock AU prices are still to be confirmed.

| Stage | Users | Infra (AWS + tooling) | AI (Ari's base case, range in brackets) | Total / month, base case | Total per user |
|---|---|---|---|---|---|
| **Pilot** (phases 0–1) | < 1,000 | ~$4,000–6,000 | up to ~$1,500 ($600–3,000) | **~$5k–7.5k** (≈ AUD 8–12k) | n/a (fixed-cost floor) |
| **Growth** | ~10,000 | ~$14,000–17,000 | ~$15,000 ($6,000–29,000) | **~$29k–32k** (≈ AUD 45–50k) | ~$3.00 |
| **Target** | ~100,000 | ~$55,000 list, **~$42,000–45,000 with commitments** | **~$151,000** ($57,000–294,000); Ari's target ~$100,000 | **~$195k–205k** (≈ AUD 300–320k); ~$145k–155k if Ari's target is met | ~$2.00 (~$1.45 at Ari's target) |

AI at the pilot and growth stages is Ari's per-user figure scaled linearly. Real pilot usage will replace these numbers at the end of phase 1.

Key messages:
1. **AI is the largest cost line at scale**, about three times the whole infrastructure bill in the base case. That is why Ari's per-org AI credit budgets (tied to the licence) and Sam's pricing need to cover it; infrastructure enforces the budgets through the AI gateway and the `ai-worker` caps in [04](04-scaling-and-load.md).
2. **The pilot stage is mostly a fixed floor** (Multi-AZ databases, NAT gateways, staging) and costs roughly the same at 50 users as at 1,000.
3. **Within infrastructure, files dominate:** file storage, CloudFront delivery and replication together are about 30% of the target-stage infra bill. Photo compression on device (Mia) and lifecycle tiering matter more than server sizing.
4. Infra alone is roughly **$5 per tenant org per month** at the target stage; with AI in the base case it is about **$20 per org**, which gives Sam the floor for pricing.

## 2. Pilot stage (< 1,000 users)

| Item | Sizing | $/month |
|---|---|---|
| **Production** | | |
| ECS Fargate (arm64) | ~13 small tasks: api ×3, web ×3, realtime ×2 (0.5 vCPU), workers ×3, relay/scheduler/webhook/ai small | ~500 |
| Aurora PostgreSQL (I/O-Optimized) | 1 writer + 1 reader `db.r7g.large`, ~50 GB | ~700 |
| RDS Proxy | | ~60 |
| ElastiCache Valkey | 2 clusters × (primary + replica) `cache.t4g.medium` | ~230 |
| NAT gateways | 3 + light data | ~150 |
| ALB, CloudFront, S3 (~1 TB), WAF | | ~200 |
| Observability (CloudWatch logs/metrics, Managed Prometheus, Grafana, X-Ray, Synthetics) | | ~250 |
| Security services (GuardDuty incl. S3 malware scan, Security Hub, Config, CloudTrail) | | ~150 |
| Backups (cross-region copies) and replication | | ~80 |
| SES, Secrets Manager, KMS, Route 53, misc | | ~60 |
| **Production subtotal** | | **~$2,400** |
| Staging (same topology, smaller; workers on Spot) | | ~900–1,200 |
| Dev + preview environments (Aurora Serverless v2, scale to zero out of hours) | | ~300–500 |
| Shared services, security tooling and log-archive accounts | | ~150–250 |
| **AWS total** | | **~$3,800–4,400** |
| Tooling: GitHub Team + Actions, Sentry, PagerDuty, status page, Expo EAS Production, Apple/Google developer accounts | | ~400–700 |
| AWS Business Support (minimum $100, ~10% of spend) | | ~400 |
| **Infra total** | | **~$4,600–5,500** |

Ways to go cheaper during pilots if needed: single-AZ staging, turn staging off out of hours (~-$500), Aurora Serverless v2 for staging, one NAT gateway in prod (accepting an AZ egress dependency). Not recommended for production.

**Credits:** AWS Activate offers startups credits (from $1,000 self-serve up to $100,000 through accelerators and VC partners), which could cover most of the first year. Worth applying for now that the product has a name (Archova).

## 3. Growth stage (~10,000 users)

| Item | Sizing | $/month |
|---|---|---|
| ECS Fargate | ~27 tasks average across the day (scheduled peaks higher) | ~1,200 |
| Aurora | writer + 1 reader `db.r7g.xlarge`, ~300 GB, RDS Proxy | ~1,500 |
| Valkey | 2 clusters × 2 nodes `cache.r7g.large` | ~760 |
| OpenSearch | 3 × `r7g.large.search` + storage | ~560 |
| S3 | ~20 TB stored (tiered), requests, Melbourne replica | ~750 |
| CloudFront | ~10 TB delivered | ~1,100 |
| NAT, ALB, data transfer | | ~400 |
| WAF | | ~250 |
| Observability | | ~800 |
| Security services | | ~500 |
| Backups | | ~400 |
| SES (~3M emails/month), misc | | ~450 |
| **Production subtotal** | | **~$8,700** |
| Staging, dev, previews, shared accounts | | ~2,300 |
| Tooling | | ~800 |
| AWS Business Support | | ~1,100 |
| **Infra total** | | **~$13,000–15,000**, budget **$14–17k** with headroom |

## 4. Target stage (~100,000 users)

| Item | Sizing | $/month (list) |
|---|---|---|
| ECS Fargate | ~60–110 tasks across services, scaled down overnight | ~4,000 |
| Aurora | writer `db.r7g.2xlarge` + 3 readers `2xlarge`, ~3 TB I/O-Optimized storage | ~5,900 |
| RDS Proxy | | ~420 |
| Valkey | 2 clusters × 2 nodes `cache.r7g.xlarge` | ~1,500 |
| OpenSearch | 6 data nodes `r7g.xlarge.search` + 3 masters + storage | ~2,500 |
| S3 | ~200 TB stored after a year at this scale (Intelligent-Tiering / Glacier IR mix), requests, Melbourne replica and replication transfer | ~7,000 |
| CloudFront | ~80 TB delivered per month (drawings, photos, tiles) | ~8,000 |
| NAT, ALB, inter-AZ and other data transfer | | ~1,500 |
| WAF | ~2–3B requests/month | ~1,800 |
| Observability | ~2.5 TB logs/month (Infrequent Access class for verbose logs), metrics, traces, synthetics, RUM | ~4,000 |
| Security services | incl. malware scanning of non-image uploads | ~2,000 |
| Backups + Aurora Global Database secondary in Melbourne | | ~3,000 |
| SES | ~20–30M emails/month (digests reduce this) + dedicated IPs | ~2,000 |
| Misc (KMS, Secrets, Route 53, AppConfig, EventBridge) | | ~500 |
| **Production subtotal** | | **~$44,000** |
| Staging (production-shaped, smaller), dev, previews, load-test runs, shared and security accounts | | ~5,000 |
| Tooling (more seats, Sentry volume, PagerDuty for 24/7 rotation, status page) | | ~2,000 |
| AWS Business Support (tiered, ~7%) or Enterprise On-Ramp | | ~4,000 |
| **Infra total, list price** | | **~$55,000** |
| With 1-year Aurora/ElastiCache/OpenSearch reservations (~30–35% off those), Compute Savings Plan (~20–25% off Fargate), CloudFront committed pricing | | **~$42,000–45,000** |

## 5. AI usage

Ari owns this line; the full model, assumptions and levers are in [docs/ai/05-cost-control.md](../ai/05-cost-control.md). Headline at 100,000 users:

| Scenario (Ari) | AI-active users | Monthly AI spend | Per registered user |
|---|---|---|---|
| Light | 30% | ~$57k | ~$0.57 |
| **Base** | 50% | **~$151k** | **~$1.51** |
| Heavy | 70%, 1.5× usage | ~$294k | ~$2.94 |
| Ari's target after cost levers | | ~$100k | ≤ $1.00 |

Of the base case, about $122k is interactive features ("Ask the project" is two thirds of that) and about $29k is background work (title block extraction, digests, weekly summaries, embeddings, Textract OCR).

What infrastructure contributes:
- **Bedrock quotas** in ap-southeast-2 (and the AU cross-region profile) requested ahead of each phase from Ari's volumes; the binding limit at peak is provider quota, not our servers (~750 concurrent streams at peak per Ari).
- **Hosting cost of AI** (gateway inside `api`, `ai-worker` tasks, pgvector in Aurora, later OpenSearch k-NN) is already in the infrastructure lines above; the AI figures here are model and AI-service spend only.
- **Cost visibility:** AI spend from Ari's `ai_usage_ledger` and the AWS bill (Bedrock and Textract tagged `cost-centre=ai`) appears on the same cost dashboard as compute and storage, so the per-user cost of the whole platform is one number.
- **Guardrails:** AWS Budgets alert on Bedrock spend per day; an ops flag pauses non-interactive AI jobs if spend runs ahead of forecast.

## 6. Cost controls

- **AWS Budgets** per account with alerts at 80% and 100% of forecast; **Cost Anomaly Detection** on each service, alerts to Owen and john.
- **Tagging** (`env`, `service`, `cell`, `cost-centre`) enforced by tag policy, so we can see cost per module (files, AI, search) and per environment.
- **Per-tenant unit economics:** storage, AI tokens and email volume per org are metered through domain events (billing module), so Sam can see which plans are profitable.
- **Commitments** only after 3 months of steady production usage: Compute Savings Plan for Fargate, reserved nodes for Aurora, ElastiCache and OpenSearch.
- **Graviton everywhere**, Fargate Spot for retryable workers and non-production, scale-to-zero for dev, VPC endpoints to keep AWS traffic off NAT.
- **Storage hygiene:** S3 lifecycle rules (Intelligent-Tiering, Glacier IR for superseded revisions and closed projects, expiry for exports and previews), log retention limits, sampling of traces.
- **Monthly cost review** (30 minutes, Owen and john) against this document, with the estimates here updated to actuals.
