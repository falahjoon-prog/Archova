import { sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError } from './errors';
import type { TenantScope } from './db';

/**
 * Retention categories and their minimum periods (compliance/07 §1 and §3, security-licensing/07 §6). The period is
 * added in Postgres, so calendar arithmetic never happens in application code. Legal hold overrides all of them.
 */
export const RETENTION_PERIODS = {
  financial_7y: '7 years', // Corporations Act s286
  timesheet_7y: '7 years', // Fair Work Act s535
  sign_in_7y: '7 years',
  induction_7y: '7 years', // from completion
  audit_log_7y: '7 years',
  sopa_evidence_10y: '10 years', // from practical completion; customers may extend, never shorten
  project_records_10y: '10 years', // from completion, on customer close
  wallet_document_7y: '7 years', // compliance/05 §7: 7 years after expiry or last use
  tax_gst_5y: '5 years', // ITAA 1936 s262A
  whs_incident_5y: '5 years', // from notification
  location_at_sign_in_12m: '12 months',
  health_monitoring_30y: '30 years',
  asbestos_monitoring_40y: '40 years',
} as const;

const YEAR_MS = 365 * 86_400_000;
const MAX_RETENTION_YEARS = 50;

export type RetentionCategory = keyof typeof RETENTION_PERIODS;
export type RetentionBlockReason = 'legal_hold' | 'retention_period';

export interface RecordRef {
  /** `schema.table`, as the guard trigger sees the record. */
  recordType: string;
  recordId: string;
  projectId?: string | null;
}

export interface RecordRetentionInput extends RecordRef {
  category: RetentionCategory;
  /** What the period counts from: transaction date, completion, notification. */
  anchor: Date;
  /** A customer extension. The period can be lengthened to this date, never shortened. */
  extendToAtLeast?: Date;
}

/** Tags a record with its retention category. Re-tagging only ever pushes `retain_until` later. */
export async function recordRetention(
  scope: TenantScope,
  input: RecordRetentionInput,
): Promise<void> {
  const period = RETENTION_PERIODS[input.category];
  // Extensions are irreversible (the database also caps retain_until at 50 years), so reject a bad date up front.
  const now = Date.now();
  if (input.anchor.getTime() > now + 5 * YEAR_MS || Number.isNaN(input.anchor.getTime()))
    throw new AppError('validation_failed', 'The retention anchor date is not plausible.');
  if (
    input.extendToAtLeast &&
    (Number.isNaN(input.extendToAtLeast.getTime()) ||
      input.extendToAtLeast.getTime() > now + MAX_RETENTION_YEARS * YEAR_MS)
  )
    throw new AppError('validation_failed', 'A retention extension cannot run past 50 years.');
  const anchor = input.anchor.toISOString();
  const extend = input.extendToAtLeast?.toISOString() ?? null;
  await scope.tx.execute(sql`
    insert into shared.retention_ledger (id, org_id, project_id, record_type, record_id, category, retain_until)
    values (${uuidv7()}, ${scope.ctx.orgId}, ${input.projectId ?? null}, ${input.recordType}, ${input.recordId},
            ${input.category}, greatest(${anchor}::timestamptz + ${period}::interval, ${extend}::timestamptz))
    on conflict (org_id, record_type, record_id, category) do update
      set retain_until = greatest(shared.retention_ledger.retain_until, excluded.retain_until)`);
}

/** Tags many records of one table and category at once (a claim's lines, a contract's schedule of values). */
export async function recordRetentionBatch(
  scope: TenantScope,
  recordType: string,
  category: RetentionCategory,
  anchor: Date,
  records: { recordId: string; projectId?: string | null }[],
): Promise<void> {
  if (records.length === 0) return;
  if (Number.isNaN(anchor.getTime()) || anchor.getTime() > Date.now() + 5 * YEAR_MS)
    throw new AppError('validation_failed', 'The retention anchor date is not plausible.');
  // Passed as Postgres array literals (ids are uuids, so nothing needs quoting): a drizzle array parameter would
  // expand into a record list instead.
  const ids = `{${records.map((r) => r.recordId).join(',')}}`;
  const projects = `{${records.map((r) => r.projectId ?? 'NULL').join(',')}}`;
  await scope.tx.execute(sql`
    insert into shared.retention_ledger (id, org_id, project_id, record_type, record_id, category, retain_until)
    select gen_random_uuid(), ${scope.ctx.orgId}, p, ${recordType}, i, ${category},
           ${anchor.toISOString()}::timestamptz + ${RETENTION_PERIODS[category]}::interval
    from unnest(${ids}::uuid[], ${projects}::uuid[]) as t(i, p)
    on conflict (org_id, record_type, record_id, category) do update
      set retain_until = greatest(shared.retention_ledger.retain_until, excluded.retain_until)`);
}

/** Why the record cannot be deleted right now, or null when it can. */
export async function retentionBlock(
  scope: TenantScope,
  ref: RecordRef,
): Promise<RetentionBlockReason | null> {
  const res = await scope.tx.execute(sql`
    select kernel.retention_block(${scope.ctx.orgId}, ${ref.recordType}, ${ref.recordId}, ${ref.projectId ?? null}) as reason`);
  return (res.rows[0] as { reason: RetentionBlockReason | null } | undefined)?.reason ?? null;
}

/**
 * Call before any delete or erasure of a record. Throws `retention.blocked` while a legal hold or an unexpired
 * retention period applies (APP 11.2). The delete trigger is the backstop for code that forgets to call it.
 */
export async function assertDeletable(scope: TenantScope, ref: RecordRef): Promise<void> {
  const reason = await retentionBlock(scope, ref);
  if (reason)
    throw new AppError(
      'retention.blocked',
      reason === 'legal_hold'
        ? 'This record is under legal hold and cannot be deleted.'
        : 'This record must be kept until its retention period ends.',
      undefined,
      { reason },
    );
}

/**
 * Places a hold on one project, or on the whole org when `projectId` is omitted. Callers check the legal-hold
 * permission first (none exists yet, so use only from tests until it does); the change goes to the outbox so it
 * reaches the security audit log. Platform holds and customer holds need separate design.
 */
export async function placeLegalHold(
  scope: TenantScope,
  input: { projectId?: string | null; reason: string },
): Promise<string> {
  const id = uuidv7();
  await scope.tx.execute(sql`
    insert into shared.legal_holds (id, org_id, project_id, reason, placed_by)
    values (${id}, ${scope.ctx.orgId}, ${input.projectId ?? null}, ${input.reason}, ${scope.ctx.userId})`);
  scope.events.add({
    type: 'retention.legal_hold.placed.v1',
    projectId: input.projectId ?? null,
    entityType: 'legal_hold',
    entityId: id,
    // No free-text reason: the outbox is not the place for it.
    data: { holdId: id, projectId: input.projectId ?? null },
  });
  return id;
}

/** Releases a hold. Returns false when it was already released or does not exist. */
export async function releaseLegalHold(scope: TenantScope, holdId: string): Promise<boolean> {
  const res = await scope.tx.execute(sql`
    update shared.legal_holds set released_by = ${scope.ctx.userId}, released_at = now()
    where id = ${holdId} and released_at is null
    returning project_id`);
  const row = res.rows[0] as { project_id: string | null } | undefined;
  if (!row) return false;
  scope.events.add({
    type: 'retention.legal_hold.released.v1',
    projectId: row.project_id,
    entityType: 'legal_hold',
    entityId: holdId,
    data: { holdId, projectId: row.project_id },
  });
  return true;
}
