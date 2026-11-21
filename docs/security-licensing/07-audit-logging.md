# 07. Audit logging

Owner: Sam. Status: draft v1, 2 Oct 2026.
Related: [02 permissions](02-roles-permissions.md), [08 privacy and compliance](08-privacy-compliance-au.md).

## 1. Why this matters more than usual

Payment claims, payment schedules, variations, transmittals and RFI responses are evidence in SOPA adjudications and building disputes. A builder must be able to prove *what* was sent, *when*, *to whom*, and that it wasn't changed afterwards. The plan already calls for an immutable trail on claims and schedules; this doc defines it for the whole platform.

## 2. Three logs, three jobs

| Log | Audience | Contents | Retention (default) |
|---|---|---|---|
| **Activity log** (`ActivityLog` in the plan) | Project users | Business events: "RFI #42 answered by J. Smith", field changes with before/after | Life of the project + archive (follows project data) |
| **Security audit log** | Org admins, our security team | Logins, MFA, SSO config, permission/membership changes, exports, API token creation, billing changes, support access, entitlement overrides | 7 years |
| **Evidence records** | Users in a dispute, adjudicators | Sealed snapshots of legally significant documents (claim, schedule, variation, notice, transmittal) with content hash and delivery receipts | 7 years after project close minimum, configurable up to 12 (see §6) |

Application/debug logs (CloudWatch, 30–90 days) are separate and are **not** audit logs.

## 3. Event schema (activity + security)

```
AuditEvent (
  id              uuidv7,
  org_id          uuid,          -- tenant; null only for platform events
  project_id      uuid null,
  occurred_at     timestamptz,   -- server time, UTC
  actor_type      user|api_client|system|support,
  actor_id        uuid,
  on_behalf_of    uuid null,     -- support impersonation or AI acting for user
  ip, user_agent, client: web|ios|android|api,
  action          text,          -- dotted verb: rfi.response.created, member.role.changed, auth.login.failed
  target_type, target_id,
  changes         jsonb,         -- {field: [before, after]}, sensitive fields redacted
  request_id      text,
  prev_hash       bytea,         -- hash chain per org
  hash            bytea          -- SHA-256(prev_hash || canonical_json(event))
)
```

- AI-assisted actions record `actor_type = user`, `on_behalf_of = null`, and `metadata.ai_assisted = true`, so humans stay accountable but AI involvement is visible.
- Redaction: passwords, tokens, MFA secrets never logged. Free-text fields with possible health information (incident descriptions) logged as "changed" without values in the security log.

## 4. Tamper evidence

1. **Append-only at the database:** `app_rw` has `INSERT` only on audit tables; a trigger rejects `UPDATE`/`DELETE` for all roles except a retention-purge role that can delete only partitions older than the retention period.
2. **Hash chain per org:** each event includes the previous event's hash. Writes per org are serialised through a short advisory lock (fine at our volumes; shard the chain per project if contention appears).
3. **External anchoring:** at least daily (Ava's `data-architecture.md` §5), and hourly for orgs with Financials on, the latest hash per org is written to an S3 bucket with **Object Lock in compliance mode** (WORM; not even our root account can delete before expiry). Any later edit to the DB breaks the chain against the anchor.
4. **Verification tool:** admin-console job that re-walks a chain and reports breaks; run weekly automatically, and on demand for a customer dispute.

## 5. Evidence records (SOPA and contract documents)

When a payment claim, payment schedule, variation, notice or transmittal is **issued** (not drafted):
- Render a PDF of exactly what the recipient sees, with all line items.
- Store PDF + canonical JSON in S3 under Object Lock (compliance mode, retention per §6).
- Store SHA-256 of both in `EvidenceRecord(id, org_id, project_id, entity_type, entity_id, version, pdf_key, json_key, sha256_pdf, sha256_json, issued_at, issued_by, recipients[])`.
- Delivery receipts appended as audit events: emailed (provider message id), delivered, opened/viewed in-app (timestamp, user).
- After issue, the record is immutable. Corrections create a new version linked to the old one; both are kept.
- One-click **evidence pack** export for a contract: all claims, schedules, variations, receipts and the chain verification result, as a ZIP with a manifest of hashes.

Time source: AWS-synced NTP; all timestamps UTC, displayed in project's state time zone. SOPA business-day calculations use the project's state (plan §2).

## 6. Retention

| Record | Default | Reason |
|---|---|---|
| Security audit log | 7 years | Common expectation for enterprise/government customers; aligns with Corporations Act financial record keeping |
| Evidence records | Project close + 7 years, org can extend to 12 | Building dispute limitation periods are long (e.g. NSW 10-year long-stop for building actions; statutory warranties up to 6 years for major defects). **Confirm with a construction lawyer.** |
| Billing records (ours) | 5+ years | ATO record keeping |
| Activity log | With project data | Deleted when the customer deletes the project/org, except where it forms part of an evidence record |

Legal hold: org admins (or our staff on a legal request) can place a project on hold, which suspends all deletion for it.

Conflict with privacy deletion requests: personal information inside evidence records is retained under the APP 11.2 exception (required by law / needed for legal claims); the requester is told this. See doc 08.

## 7. Access and export

- Org admins: security audit log viewer with filters (user, action, date, project) and CSV export.
- Business/Enterprise: audit log API; Enterprise: streaming to the customer's SIEM (webhook or S3 delivery, e.g. into Splunk/Sentinel).
- Project users see the activity log of items they can access (permission-filtered like everything else).
- Our staff access to customer audit logs is itself audited.

## 8. Volume and storage at scale

Estimate at 100k users: ~50 events/user/working day → ~5M events/day, ~1.2B/year. Plan:
- Postgres table partitioned monthly by `occurred_at`; recent 13 months hot.
- Older partitions exported to S3 as Parquet (also Object-Locked) and dropped from Postgres; queried via Athena for investigations and customer requests.
- Writes go through the job queue in batches (outbox pattern: event written in the same transaction as the business change into an outbox table, then moved to the audit table), so audit logging never slows down a user action and is never lost if the queue is down.

## 9. Alerts from the security log

Real-time rules (examples): 10+ failed logins on one account; login from a new country for an admin; SSO config changed; bulk export > N files; API token created with admin scopes; support access session started. Alerts go to the org's admins (their settings) and to our security on-call for platform-level patterns.

## 10. Implementation status (`modules/audit`)

Built: the security audit log (§3, §4, §9, and the viewer API in §7).

- **Write path:** `recordSecurityEvent(tx, …)` in `@archova/kernel` calls `audit.append_event()`, a security-definer function that is the only way to add an event. `app_rw` has no insert, update or delete on `audit.security_events`; triggers refuse UPDATE, DELETE and TRUNCATE for every role. The event is written in the caller's transaction, so it exists if and only if the change commits.
- **Chain:** one chain per org, plus 16 platform shard chains (org ids `00000000-0000-0000-0000-0000000000nn`, chosen by the event's target) for events with no org, such as sign-ins. `append_event` refuses any org other than the one the transaction runs in (`app.org_id`), or null in a transaction with none. Failed sign-ins beyond 20 per account and address in 15 minutes are not stored; `changes` and `metadata` over 8 KB are replaced by a truncation marker. Each event stores `seq`, `prev_hash` and `hash = SHA-256(prev_hash || canonical JSON)`. The canonical text and the hash are computed in SQL (`audit.canonical`, `audit.link_hash`), so writing and verifying cannot drift.
- **Anchors:** `audit.anchor` job (hourly, only when the chain moved) writes `{orgId, seq, hash}` to the Object Lock bucket named by `WORKER_AUDIT_ANCHOR_BUCKET` (`WORKER_AUDIT_ANCHOR_STORE=s3`) and records the anchor through `audit.record_anchor()`, which reads the hash from the event itself. Org chains and the platform shards are all covered. Outside production, no bucket means a database-only anchor; the worker refuses to start in production without the bucket.
- **Verifier:** `audit.verify` job (weekly) re-walks each org's chain: links, hashes, gaps, the head, and every anchor. A break is recorded and raises an `audit.chain_broken` alert.
- **Events recorded today:** `auth.login.succeeded`, `auth.login.failed` (account named by an HMAC-SHA256 of the address with `API_AUDIT_PEPPER`, required in production), `auth.session.revoked`, `api_token.created`, `api_token.revoked`, `project_member.added`, `project_member.removed`, `export.requested`, `export.downloaded`, `support.session.started`.
- **Alerts (real time, in the write):** ten failed sign-ins on one account in 15 minutes; support session started; SSO settings changed; API token with write scope; full data export requested.
- **API:** `GET /v1/orgs/{orgId}/security-audit-events` (filters, cursor), `…/security-audit-alerts`, `…/security-audit-integrity`; permission `audit.security.read` (owners and admins).

Not built yet: MFA and SSO events (the code paths do not exist yet), org role and permission-template changes, monthly partitioning and the 7-year purge, Parquet archive, CSV export and SIEM streaming, delivery of alerts to admins and the platform on-call, a web screen, and a read-back comparison of the database against the Object Lock copies (the worker's role can only put), a reader and notifier for platform-shard alerts, the `sso.config.changed` emitter, and the retention and erasure path. Sign-ins from the platform chain are not yet shown to the org's admins.
