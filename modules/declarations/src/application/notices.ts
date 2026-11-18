import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { declarationLabel } from '../domain/declaration';

/** Every notice kind this module raises. */
export const DECLARATION_NOTICE_KINDS = [
  'declarations.workers_comp_expiring',
  'declarations.workers_comp_expired',
] as const;
export type DeclarationNoticeKind = (typeof DECLARATION_NOTICE_KINDS)[number];

/** Days before the end date at which a reminder is due. Only the most urgent step reached is sent. */
export const REMINDER_STEPS = [30, 14, 7, 0] as const;
/** An expired notice stops this many days after the end date. */
const EXPIRED_NOTICE_DAYS = 14;

export interface DeclarationNoticeCandidate {
  declarationId: string;
  projectId: string;
  number: number;
  companyName: string;
  validTo: string;
  daysLeft: number;
  /** The requirement's lead days for workers' compensation, else null. */
  leadDays: number | null;
  /** Whether a later accepted workers' compensation declaration for the same company already runs on. */
  replaced: boolean;
  recipients: string[];
}

export interface PlannedDeclarationNotice {
  userId: string;
  projectId: string;
  declarationId: string;
  kind: DeclarationNoticeKind;
  title: string;
  body: string;
  dedupeKey: string;
}

/**
 * Accepted workers' compensation declarations ending within 30 days or ended within the last two weeks, in each
 * project's own calendar. (Payroll tax and wages declarations are renewed with every claim period, so they are chased
 * through the claim gate, not by reminders.) Told to whoever recorded the declaration.
 */
export async function findDeclarationNotices(
  scope: TenantScope,
  now: Date,
): Promise<DeclarationNoticeCandidate[]> {
  const rows = await scope.tx.execute<{
    declaration_id: string;
    project_id: string;
    number: number;
    company_name: string;
    valid_to: string;
    days_left: number;
    lead_days: number | null;
    replaced: boolean;
    recipient: string | null;
  }>(sql`
    select d.id as declaration_id, d.project_id, d.number, c.name as company_name,
           to_char(d.valid_to, 'YYYY-MM-DD') as valid_to,
           (d.valid_to - (${now.toISOString()}::timestamptz at time zone pr.timezone)::date) as days_left,
           (select r.lead_days from declarations.requirements r where r.project_id = d.project_id and r.kind = d.kind) as lead_days,
           exists (
             select 1 from declarations.statements n
              where n.project_id = d.project_id and n.company_id = d.company_id and n.kind = d.kind
                and n.deleted_at is null and n.lifecycle = 'accepted' and n.valid_to > d.valid_to
           ) as replaced,
           d.created_by::text as recipient
      from declarations.statements d
      join platform.projects pr on pr.id = d.project_id
      join platform.companies c on c.id = d.company_id
     where d.deleted_at is null
       and d.kind = 'workers_comp'
       and d.lifecycle = 'accepted'
       and d.valid_to <= (${now.toISOString()}::timestamptz at time zone pr.timezone)::date + 30
       and d.valid_to >= (${now.toISOString()}::timestamptz at time zone pr.timezone)::date - ${EXPIRED_NOTICE_DAYS}::int
  `);
  return rows.rows
    .filter((r) => r.recipient)
    .map((r) => ({
      declarationId: r.declaration_id,
      projectId: r.project_id,
      number: Number(r.number),
      companyName: r.company_name,
      validTo: r.valid_to,
      daysLeft: Number(r.days_left),
      leadDays: r.lead_days === null ? null : Number(r.lead_days),
      replaced: r.replaced,
      recipients: [r.recipient!],
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
 * One inbox item per person per declaration per end date and step, so a renewal re-arms the reminders and a rerun
 * tells nobody twice. One already replaced by a later declaration is history and raises nothing.
 */
export function planDeclarationNotices(
  candidates: readonly DeclarationNoticeCandidate[],
): PlannedDeclarationNotice[] {
  return candidates.flatMap((c): PlannedDeclarationNotice[] => {
    if (c.replaced) return [];
    const name = `${declarationLabel(c.number)} workers' compensation declaration (${c.companyName})`;
    if (c.daysLeft < 0)
      return c.recipients.map((userId) => ({
        userId,
        projectId: c.projectId,
        declarationId: c.declarationId,
        kind: 'declarations.workers_comp_expired' as const,
        title: `${declarationLabel(c.number)} has run out`,
        body: `${name} ended on ${c.validTo}. Ask ${c.companyName} for a current one before their next claim.`,
        dedupeKey: `declaration:${c.declarationId}:${c.validTo}:expired`,
      }));
    const step = reminderStep(c.daysLeft, c.leadDays);
    if (step === null) return [];
    return c.recipients.map((userId) => ({
      userId,
      projectId: c.projectId,
      declarationId: c.declarationId,
      kind: 'declarations.workers_comp_expiring' as const,
      title: `${declarationLabel(c.number)} runs out ${c.daysLeft === 0 ? 'today' : `in ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'}`}`,
      body: `${name}. Ends ${c.validTo}. Ask for the next one so claims are not held up.`,
      dedupeKey: `declaration:${c.declarationId}:${c.validTo}:${step}`,
    }));
  });
}
