# 05 · Monitoring, alerting and incident response

**Owner:** Jeff · **Status:** Draft v1 · 2 Oct 2026

## 1. Stack

All telemetry stays in ap-southeast-2 (decision I7), because logs and traces inevitably contain tenant identifiers and fragments of customer data.

| Signal | Collected by | Stored in | Viewed in |
|---|---|---|---|
| Logs | Structured JSON (pino) to stdout → FireLens / awslogs | CloudWatch Logs (30 days hot) → S3 via subscription (1 year), queried with Athena | CloudWatch Logs Insights, Grafana |
| Metrics | OpenTelemetry SDK in every service → ADOT collector sidecar | Amazon Managed Service for Prometheus; AWS service metrics in CloudWatch | Amazon Managed Grafana |
| Traces | OpenTelemetry SDK → ADOT collector (tail sampling) | AWS X-Ray | X-Ray console, Grafana |
| Web real-user monitoring | CloudWatch RUM (Core Web Vitals, JS errors) | CloudWatch, Sydney | Grafana |
| Web and mobile crashes | Sentry SDK with PII scrubbing (no request bodies, no user names/emails, IDs only) | Sentry (US/EU; see residency note in [01](01-cloud-setup.md#1-regions-and-data-residency)) | Sentry |
| Synthetic checks | CloudWatch Synthetics canaries (Sydney) + one external uptime service (outside AWS) | CloudWatch | Grafana, status page |
| Security signals | GuardDuty, Security Hub, CloudTrail, Config, WAF logs | Security tooling and log-archive accounts | Security Hub (Sam) |
| Cost | Cost Explorer, CUR 2.0 → Athena, Cost Anomaly Detection | Management account | Grafana cost dashboard |

## 2. Instrumentation standards (every service)

Ava's conventions doc is the source; infra needs these minimums:

- **Every log line** is JSON with `timestamp`, `level`, `service`, `env`, `cell`, `version` (git SHA), `trace_id`, `span_id`, `request_id`, `org_id`, `user_id` (internal IDs only), `route`, `duration_ms`, `status`.
- **Never log** passwords, tokens, presigned URLs, email addresses, phone numbers, document contents, AI prompts or outputs, or request bodies. A redaction step in the logger enforces a deny-list; CI has a test for it.
- **Traces** propagate W3C `traceparent` from web/mobile → api → outbox → workers, so one RFI submission can be followed through its notification, email and AI jobs.
- **Health endpoints:** `/healthz` (process alive, used by ECS) and `/readyz` (dependencies reachable, used by the ALB). Readiness must not fail on a non-critical dependency (e.g. OpenSearch down should degrade search, not take the API out of the load balancer).
- **RED metrics per route** (rate, errors, duration), **queue metrics per queue** (waiting, active, failed, oldest job age, processing time), **DB pool metrics**, **business events** (RFIs created, claims submitted, uploads failed, sync conflicts) as counters with `org_tier` but not `org_id` labels (cardinality).
- **Per-tenant usage** (storage, AI tokens, seats, API calls) is a billing concern and flows through domain events to the billing module (Sam), not through Prometheus.

### Trace sampling
Tail sampling in the collector: keep 100% of traces with errors or latency above the route's p99 target, 100% for the synthetic tenant, and 5% of everything else. Tunable without a deploy.

## 3. Dashboards (Managed Grafana)

| Dashboard | Shows | Audience |
|---|---|---|
| **Service health overview** | SLOs and error-budget burn per service, request rate, 5xx rate, p95/p99, deploy markers | Everyone, on the team screen |
| Per service (api, web, realtime, each worker group, ai-worker) | RED metrics, task count vs autoscaling target, CPU/memory, restarts | Owners |
| Database | Writer/reader CPU, connections (proxy and DB), replica lag, slow queries (Performance Insights), deadlocks, storage growth, top queries by tenant | Ben, Jeff |
| Queues and jobs | Backlog, oldest job age, failure rate, dead-letter count per queue; SOPA scheduler last-run | Ben, Jeff |
| Mobile | Crash-free sessions and users per app version, sync success rate, sync duration, OTA adoption | Mia |
| Web | Core Web Vitals (LCP, INP, CLS) by route, JS error rate | Felix |
| AI | Requests, latency, token usage, cost per day and per tenant tier, guardrail blocks, error rate by model | Ari |
| Cost | Daily spend by service and `cost-centre` tag, forecast vs budget | john, Jeff |
| Security | WAF blocks, auth failures, GuardDuty findings, unusual admin activity | Sam |

## 4. Alerting

Alerts route through **PagerDuty** (or incident.io; decide at setup). Two classes only: **page** (someone must act now, any hour once 24/7 starts) and **ticket** (next business day). Every page has a runbook link ([08](08-runbooks-index.md)).

### Pages
| Alert | Condition |
|---|---|
| SLO fast burn | Error budget burning at ≥ 14× rate over 1 h (≈ 2% of monthly budget per hour), confirmed over 5 min |
| API or web down | Synthetic login/create-RFI canary fails from 2 of 3 checks for 3 min |
| 5xx spike | 5xx > 2% of requests for 5 min on api or web |
| Latency | p95 above 2× SLO target for 10 min |
| **SOPA scheduler missed** | Dead-man's switch: the due-date/reminder run did not report success within 10 min of schedule |
| Critical queue stuck | Oldest job in `notifications`, `email`, `sopa`, or `sync` older than 10 min |
| Database | Writer unavailable, failover occurred, replica lag > 30 s, free storage/ACU or connection saturation > 90% |
| Valkey (queue cluster) | Memory > 85% (queue cluster is `noeviction`, so full means rejected jobs), failover |
| Security high | GuardDuty high-severity finding, root/break-glass login, CloudTrail disabled attempt (routes to Sam and Jeff) |
| AI egress blocked | Network Firewall dropped traffic from the restricted subnets (api, ai-worker) to an AI-related domain not on the allow-list, or any decrypt of the BYO AI-provider KMS key by an unexpected principal (routes to Sam and Jeff) |
| Backup failure | AWS Backup job failed for prod Aurora or the cross-region copy failed twice in a row |

### Tickets
SLO slow burn (≥ 2× over 24 h), dead-letter queue non-empty, certificate expiry < 21 days, storage growth ahead of forecast, cost anomaly > 20% of daily forecast, dependency vulnerability (high), drift detected, mobile crash-free rate < 99.5% on the latest version, Web Vitals regression after deploy.

## 5. Synthetic checks

**Production synthetic tenant (X40, with Ari).** A hidden org, `archova-synthetic`, exists in every production cell. It and its companion canary org are excluded from billing, metering, analytics, customer counts and search suggestions across orgs, and flagged so support never contacts it. It holds fixed seed projects and fake people (no real email addresses; email goes to a sink domain we own). It is used for:
- **post-deploy checks for every module** (RFIs, documents and drawings, diary, defects, transmittals, meetings, photos, claims once shipped, workforce sign-in, AI features), run as the last step of each production deploy; a failure triggers automatic rollback while the old task set is still kept;
- **cross-tenant canaries**: a second synthetic org holds marker records; the leakage suite (Quinn, Sam, Ben) checks those markers never appear for the first org in API responses, files, cache, search, vectors, realtime channels, queues, email or logs;
- **Nova checks** (Ari, [ai/06 §9](../ai/06-evaluation.md)): after every deploy **and hourly**, known questions with expected citations, one task per Nova feature, and canary queries from the second synthetic org, all through the full gateway and the AU-only egress path. Ari supplies the synthetic data and expected answers.
- **Paging:** any cross-tenant canary hit (AI or otherwise) pages the on-call immediately as a SEV1 security incident, with Sam; a failed known-answer check opens a ticket for Ari, or pages if more than one feature fails at once.

Data it creates is cleaned up by the checks themselves and by a nightly purge. Ari owns the AI scenarios; Jeff owns the tenant, schedules and alerting.

Run from CloudWatch Synthetics in Sydney every 5 minutes (login every minute), against the synthetic tenant:

1. Load the web app and sign in.
2. Open a project, list RFIs, create an RFI with an attachment, then delete it.
3. Request a presigned upload, upload a small photo, wait for its thumbnail.
4. Open a WebSocket and receive a test notification.
5. Call the public API with an API key.

One external uptime check (e.g. Better Stack or similar, outside AWS) hits the login page and API health so we still know when CloudWatch itself is impaired.

## 6. On-call

| Stage | Coverage |
|---|---|
| Pre-launch / pilots | Business hours (7am–7pm AEST), Jeff primary, Ben secondary; best effort after hours |
| First paying customers | 24/7 rotation, weekly shifts, at least 4 engineers in the rotation; primary + secondary |
| Escalation | Primary (5 min ack) → secondary (15 min) → Ava → john for customer communication |

Paid on-call allowance and a day off after a heavy night are policy, not favours.

## 7. Incident process

| Severity | Definition | Response |
|---|---|---|
| **SEV1** | Platform down or data integrity/security at risk for many tenants; SOPA deadlines at risk | Page immediately; incident lead + comms lead; status page updated within 15 min, then every 30 min; customer email for data issues |
| **SEV2** | Major feature broken or badly degraded (uploads failing, mobile sync failing) for many tenants, or any feature for one large tenant | Page; status page within 30 min |
| **SEV3** | Minor degradation, workaround exists | Ticket, fix in normal flow |

- **Status page** at `status.<domain>` (hosted, e.g. Atlassian Statuspage or Instatus), with components per product area.
- **Incident channel** per incident; one person leads, one communicates, others investigate.
- **Blameless postmortem** for every SEV1/SEV2 within 5 business days: timeline, impact (tenants, minutes, SOPA deadlines affected), root cause, what went well, actions with owners and dates.
- **Security incidents** follow Sam's incident response plan, including Notifiable Data Breaches (Privacy Act) assessment within the 30-day window.
- SOPA deadline note: if an outage could have stopped a customer serving a payment schedule on time, the incident report says so explicitly, and john decides on customer communication. Incident records carry the affected window, services and tenants in a structured form so the product's **service availability statement** export for adjudication (Sam, security-licensing 07 §6a) can draw on them.
