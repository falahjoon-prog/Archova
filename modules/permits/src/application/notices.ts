import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { PERMIT_KIND_LABELS, permitLabel, type PermitKind } from '../domain/permit';

/** Every notice kind this module raises. */
export const PERMIT_NOTICE_KINDS = ['permits.permit_expiring', 'permits.permit_expired'] as const;
export type PermitNoticeKind = (typeof PERMIT_NOTICE_KINDS)[number];

/** Days before expiry at which a reminder is due. Only the most urgent step reached is sent. */
export const REMINDER_STEPS = [30, 14, 7, 0] as const;
/** An expired notice stops this many days after the expiry date. */
const EXPIRED_NOTICE_DAYS = 14;

export interface PermitNoticeCandidate {
  permitId: string;
  projectId: string;
  number: number;
  kind: PermitKind;
  title: string;
  lifecycle: 'active' | 'renewal_in_progress';
  expiresOn: string;
  daysLeft: number;
  /** The requirement's lead days for this kind, else null. */
  leadDays: number | null;
  recipients: string[];
}

export interface PlannedPermitNotice {
  userId: string;
  projectId: string;
  permitId: string;
  kind: PermitNoticeKind;
  title: string;
  body: string;
  dedupeKey: string;
}

/**
 * Open permits expiring within 30 days or expired within the last two weeks, in each project's own calendar. Told to
 * whoever added the permit and to the holder company's active members on the project.
 */
export async function findPermitNotices(
  scope: TenantScope,
  now: Date,
): Promise<PermitNoticeCandidate[]> {
  const rows = await scope.tx.execute<{
    permit_id: string;
    project_id: string;
    number: number;
    kind: PermitKind;
    title: string;
    lifecycle: 'active' | 'renewal_in_progress';
    expires_on: string;
    days_left: number;
    lead_days: number | null;
    recipients: string[] | null;
  }>(sql`
    select p.id as permit_id, p.project_id, p.number, p.kind, p.title, p.lifecycle,
           to_char(p.expires_on, 'YYYY-MM-DD') as expires_on,
           (p.expires_on - (${now.toISOString()}::timestamptz at time zone pr.timezone)::date) as days_left,
           (select r.lead_days from permits.requirements r where r.project_id = p.project_id and r.kind = p.kind) as lead_days,
           array(
             select distinct pm.user_id::text from platform.project_members pm
              where pm.project_id = p.project_id and pm.status = 'active'
                and (pm.user_id = p.created_by
                  or (p.holder_company_id is not null and pm.company_id = p.holder_company_id))
           ) as recipients
      from permits.permits p
      join platform.projects pr on pr.id = p.project_id
     where p.deleted_at is null
       and p.lifecycle <> 'closed'
       and p.expires_on is not null
       and p.expires_on <= (${now.toISOString()}::timestamptz at time zone pr.timezone)::date + 30
       and p.expires_on >= (${now.toISOString()}::timestamptz at time zone pr.timezone)::date - ${EXPIRED_NOTICE_DAYS}::int
  `);
  return rows.rows
    .filter((r) => (r.recipients ?? []).length > 0)
    .map((r) => ({
      permitId: r.permit_id,
      projectId: r.project_id,
      number: Number(r.number),
      kind: r.kind,
      title: r.title,
      lifecycle: r.lifecycle,
      expiresOn: r.expires_on,
      daysLeft: Number(r.days_left),
      leadDays: r.lead_days === null ? null : Number(r.lead_days),
      recipients: r.recipients ?? [],
    }));
}

/** The reminder step reached, or null when none is due yet. A requirement's lead days adds its own first step. */
export function reminderStep(daysLeft: number, leadDays: number | null): number | null {
  const steps = [
    ...new Set([...(leadDays && leadDays <= 30 ? [leadDays] : []), ...REMINDER_STEPS]),
  ].sort((a, b) => a - b);
  return steps.find((s) => daysLeft <= s) ?? null;
}

/**
 * One inbox item per person per permit per expiry date and step, so renewing (a new expiry date) re-arms the
 * reminders and a rerun tells nobody twice. A permit already being renewed is not nagged before it expires.
 */
export function planPermitNotices(
  candidates: readonly PermitNoticeCandidate[],
): PlannedPermitNotice[] {
  return candidates.flatMap((c): PlannedPermitNotice[] => {
    const name = `${permitLabel(c.number)} ${PERMIT_KIND_LABELS[c.kind].toLowerCase()}: ${c.title}`;
    if (c.daysLeft < 0)
      return c.recipients.map((userId) => ({
        userId,
        projectId: c.projectId,
        permitId: c.permitId,
        kind: 'permits.permit_expired' as const,
        title: `${permitLabel(c.number)} has expired`,
        body: `${c.title} expired on ${c.expiresOn}.${c.lifecycle === 'renewal_in_progress' ? ' Renewal is in progress.' : ' Renew it or close it on the register.'}`,
        dedupeKey: `permit:${c.permitId}:${c.expiresOn}:expired`,
      }));
    if (c.lifecycle === 'renewal_in_progress') return [];
    const step = reminderStep(c.daysLeft, c.leadDays);
    if (step === null) return [];
    return c.recipients.map((userId) => ({
      userId,
      projectId: c.projectId,
      permitId: c.permitId,
      kind: 'permits.permit_expiring' as const,
      title: `${permitLabel(c.number)} expires ${c.daysLeft === 0 ? 'today' : `in ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'}`}`,
      body: `${name}. Expiry ${c.expiresOn}. Start the renewal so it does not lapse.`,
      dedupeKey: `permit:${c.permitId}:${c.expiresOn}:${step}`,
    }));
  });
}
