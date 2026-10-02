# 08 · Runbooks and operational readiness

**Owner:** Owen · **Status:** Draft v1 · 2 Oct 2026

Runbooks are written as the systems are built (phase 0), stored in `docs/runbooks/` in the monorepo next to the code, and linked from every alert in [05](05-observability.md#4-alerting). Each runbook has: symptoms, dashboards to open, diagnosis steps with exact commands, fixes, rollback, escalation, and the date it was last tested.

## 1. Runbooks to write

| Runbook | Needed by |
|---|---|
| Deploy, roll back, and hotfix (web, api, workers) | Phase 0 |
| Run, retry, or roll forward a database migration | Phase 0 |
| API 5xx spike / latency SLO burn | Phase 0 |
| Aurora failover, replica lag, connection saturation, slow query triage | Phase 0 |
| Valkey memory pressure / queue cluster full | Phase 0 |
| Queue backlog and dead-letter handling, per queue | Phase 0 |
| SOPA scheduler missed run: reconcile and re-send reminders | Phase 0 (before any claim goes live, phase 3, it must be tested) |
| Point-in-time restore (whole DB) | Phase 0 |
| Single-tenant restore | Phase 1 |
| Restore a deleted file or drawing revision | Phase 1 |
| Upload pipeline stuck (malware scan, thumbnails, drawing tiles) | Phase 1 |
| Mobile sync failures and OTA rollback | Phase 3 |
| WebSocket reconnect storm | Phase 1 |
| AI provider outage or runaway spend (kill switch) | Phase 1 (when AI ships) |
| WAF false positives / blocking a customer | Phase 1 |
| Rotate secrets and signing keys, revoke a leaked credential | Phase 0 |
| Security incident first response (with Sam's IR plan) | Phase 0 |
| Region failover to Melbourne and fail back | Phase 2 (rehearsed), mandatory phase 3 |
| Scale a cell up a tier (DB resize, OpenSearch nodes) | Phase 1 |
| Stand up a new cell; move a tenant between cells | Phase 4 or first enterprise deal |
| Tenant offboarding: export and delete | Phase 1 |
| Certificate / domain renewal problems | Phase 0 |

## 2. Operational readiness checklist (before the first pilot goes live)

Infrastructure
- [ ] All environments built from Terraform; no manual resources in staging or prod (drift check clean)
- [ ] Multi-AZ verified for every prod component; AZ game day run in staging
- [ ] WAF in block mode with rate limits; Shield Standard; TLS 1.2+ only
- [ ] SCPs active (region lock, no IAM users, CloudTrail protection)

Delivery
- [ ] CI pipeline green with all required checks; blue/green with automatic rollback tested
- [ ] Migration safety checks in CI; expand/contract documented and followed
- [ ] Mobile build and store submission pipeline tested end to end (internal tracks)

Observability
- [ ] SLO dashboards and burn-rate alerts live; every page alert has a runbook
- [ ] Synthetic checks running against the canary org
- [ ] Log redaction test passing; no PII in logs (spot-checked)
- [ ] On-call rotation and escalation configured; status page live

Data protection
- [ ] PITR restore drill completed successfully this month
- [ ] Cross-region backup copies arriving in the locked backup vault
- [ ] S3 versioning, replication and Object Lock (audit archive) verified

Scale
- [ ] Baseline load test at 2× expected pilot load passed; 100k-user test scheduled before the growth stage

Cost
- [ ] Budgets and anomaly alerts configured; tagging enforced

## 3. Open questions for the team

1. **Ava:** confirm mobile uses `api.<domain>/realtime` for its socket ([01 §4](01-cloud-setup.md#4-edge-and-traffic-flow)).
2. **Ben:** confirm all jobs are idempotent and re-creatable from database state (DR assumption).
3. **Ari and Owen:** confirm which Claude models Bedrock serves in AU, their AU prices and default quotas, then re-run the AI cost model with Bedrock prices.
4. **Sam:** legal retention period for claims and audit data (drives yearly backup and Object Lock retention); whether Sentry's US/EU hosting with scrubbing is acceptable or we self-host; DR targets to state in pilot terms.
5. **Mia:** on-device photo compression target (drives the largest storage and delivery cost line).
6. **john:** register the Archova domain (needed for DNS, certificates and email sending); budget appetite for the pilot stage (~USD 5k/month) and whether to pursue AWS Activate credits.
