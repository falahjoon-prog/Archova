# 06 · Backups and disaster recovery

**Owner:** Jeff · **Status:** Draft v1 · 2 Oct 2026

## 1. Recovery targets

| Scenario | Example | RPO (data loss) | RTO (time to recover) | How |
|---|---|---|---|---|
| Task or instance failure | A container crashes | 0 | Seconds | ECS replaces tasks; ALB health checks |
| Availability Zone loss | One Sydney AZ fails | 0 (≈ 0 for Valkey jobs) | < 5 min | Everything runs across 3 AZs; Aurora Multi-AZ failover ≈ 30 s; Valkey replica promotion |
| Bad deploy | Release breaks a feature | 0 | < 5 min | Blue/green rollback ([03](03-ci-cd.md#9-rollback)) |
| Logical corruption, whole database | Bad migration or bug corrupts rows | Point in time, to the second | 2–4 h | Aurora point-in-time restore to a new cluster, verify, cut over |
| Logical corruption or deletion, one tenant | A customer (or bug) deletes a project | To the second | 1 business day | Restore to a side cluster, extract that tenant's rows, merge back with a reviewed script |
| Deleted or overwritten file | User deletes a drawing | 0 within 90 days | Minutes | S3 versioning (previous versions kept 90 days) |
| **Region loss, phases 0–2** | Sydney region unavailable | ≤ 24 h | ≤ 24 h | Restore from cross-region backup copies in Melbourne into pre-built infra |
| **Region loss, phase 3 onward** (claims live) | Same | **< 1 min** | **≤ 4 h** | Aurora Global Database secondary in Melbourne, promoted; S3 replicas; pilot-light compute scaled up |
| Account compromise / ransomware | Attacker deletes prod resources and backups | ≤ 24 h | ≤ 24 h | Locked backup vault in a separate account and region that prod credentials cannot touch |

The jump in region-loss targets at phase 3 is deliberate. Before payment claims run in the platform, a day's data loss in a regional disaster is tolerable for pilots (and is the cheapest option); once SOPA claims and payment schedules live here, it is not. Pilots are told the phase 0–2 target in writing; Sam has it on the pilot terms list (security-licensing 08 §8).

## 2. What is backed up, and how

| Data | Primary protection | Backups | Retention | Copies |
|---|---|---|---|---|
| **Aurora PostgreSQL** (system of record) | Multi-AZ storage (6 copies across 3 AZs) | Continuous backup with point-in-time restore; AWS Backup daily snapshot, plus monthly and yearly | PITR 35 days; daily 35 days; monthly 12 months; yearly 7 years (agreed with Sam). Legal retention of claims evidence is **not** carried by backups: it comes from Sam's Object-Locked evidence records (project close + 7 years, extendable to 12; security-licensing 07 §5) | Copied to the `backup` account vault in Sydney **and** Melbourne; Global Database in Melbourne from phase 3 |
| **S3 `files`** (drawings, documents, photos) | 11 nines durability, versioning | Cross-region replication to a bucket in Melbourne **owned by the backup account**, with delete markers not replicated | Current versions forever (until tenant offboarding); noncurrent versions 90 days | 2 regions, 2 accounts |
| **S3 `audit-archive`** | Object Lock **compliance mode** (cannot be deleted by anyone, including root, until retention expires) | Replicated to Melbourne with the same lock | ≥ 7 years | 2 regions |
| **Website CMS** (`archova-marketing`: RDS PostgreSQL + S3 media) | Multi-AZ RDS, S3 versioning | RDS PITR; daily AWS Backup copy to the backup account and Melbourne; media replicated to Melbourne | PITR 14 days; daily 35 days | 2 regions (no customer data) |
| **S3 `exports`** | Versioning | None (regenerable) | 30 days lifecycle | 1 |
| Valkey (queues, cache) | Multi-AZ replica | Daily snapshot of the queue cluster | 7 days | 1 |
| OpenSearch | 3-AZ replicas | Automated hourly snapshots | 14 days | Rebuildable from Postgres, so not critical |
| Secrets (Secrets Manager) | Managed | Replicated to Melbourne | — | 2 regions |
| Container images (ECR) | Managed | Replicated to Melbourne | Last 50 images per service, all images ever deployed to prod for 1 year | 2 regions |
| Terraform state | S3 versioning + DynamoDB lock | Replicated to Melbourne | All versions 1 year | 2 regions |
| Source code | GitHub | Nightly mirror to an S3 bucket (`git bundle`) in `shared-services` | 90 days | 2 providers |
| Mobile signing keys | EAS credentials | Encrypted offline copy held by john and Jeff | — | — |

**Why the outbox matters for DR:** domain events live in Postgres (Ava D7) and scheduled SOPA jobs are re-derived from the database by the scheduler, so losing Valkey loses at most in-flight jobs, which are re-enqueued from the database state after recovery. Ben's job design must keep every job idempotent and re-creatable for this to hold.

### Backup account protections
- AWS Backup **Vault Lock** (compliance mode) on the backup vaults: recovery points cannot be deleted before retention ends, even by an administrator.
- Production accounts can write to the vault but not delete from it; restores need a role in the backup account (two-person approval for production restores).
- Backups encrypted with KMS keys owned by the backup account.

## 3. Disaster recovery to Melbourne

### Phases 0–2: backup-and-restore
- Terraform for a full cell exists for `ap-southeast-4`, with the network and empty ECS cluster pre-built (cost: a few dollars a month), but no databases running.
- On a declared region loss: restore the latest Aurora snapshot copy in Melbourne, point services at the replica S3 bucket, scale ECS services, switch Route 53.
- Expected effort: ~4–8 hours of work once declared; the RPO is the age of the latest cross-region copy (≤ 24 h).

### Phase 3 onward: pilot light
- **Aurora Global Database** with a secondary cluster in Melbourne (one small instance, so it can serve as a warm reader for DR tests). Replication lag is typically under 1 second.
- S3 replication with Replication Time Control (15-minute SLA) for `files`.
- ECS services defined in Melbourne at zero tasks, images already replicated, secrets replicated.
- Route 53 health-checked failover records for `app.` and `api.`, switched manually (a human declares the disaster, to avoid flapping during partial outages).

### Failover runbook outline
1. Incident lead declares a regional DR event (criteria: Sydney services unrecoverable within the RTO per AWS Health and our own checks).
2. Freeze: stop any still-running Sydney writers if reachable (prevents split brain).
3. Promote the Melbourne Aurora secondary (managed failover if Sydney is reachable, detach-and-promote otherwise).
4. Scale Melbourne ECS services to the production floor; warm caches.
5. Switch DNS; confirm synthetic checks pass in Melbourne.
6. Re-enqueue jobs from database state (scheduler reconciliation run), verify SOPA jobs.
7. Status page and customer communication throughout.
8. Fail back to Sydney in a planned window once stable (reverse replication first).

## 4. Testing recovery

A backup that has not been restored is a hope, not a backup.

| Drill | Frequency | Pass criteria |
|---|---|---|
| Aurora PITR restore of production into an isolated account, automated integrity checks (row counts per table, checksums on claims and audit tables, RLS policies present) | Monthly, automated | Restore completes within 2 h, checks pass; result posted to the team |
| Single-tenant restore (extract one org from a restored copy) | Quarterly | Completed within 1 business day by someone other than the author of the runbook |
| S3 object restore from previous version and from Melbourne replica | Quarterly | Files byte-identical |
| AZ failure game day (in staging, then in production during a quiet window) | Twice a year | SLOs hold, no manual steps needed |
| Region failover to Melbourne (loadtest copy in phases 0–2; production-shaped rehearsal from phase 3) | Twice a year | Meets the RTO/RPO for the phase |
| Backup account access drill (restore using only backup-account credentials) | Yearly | Works without any prod credentials |

## 5. Data lifecycle and tenant offboarding

- When a tenant leaves, their data is exported for them (Ben/Sam define the format) and then deleted from the live systems within the contractual window.
- Deleted data remains in backups until those backups expire (35 days for daily, up to 7 years for yearly and the audit archive). This must be stated in the privacy policy and terms (Sam). Where a yearly backup is restored for any reason, offboarded tenants are purged again before use.
- Legal holds (Ben's file storage doc) suspend deletion for named projects; infra enforces this with S3 Object Lock legal hold on the affected prefixes.
