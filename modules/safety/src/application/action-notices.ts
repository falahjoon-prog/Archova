import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { incidentLabel } from '../domain/incident';

/** An open corrective action raised recently, with everyone it was assigned to. */
export interface ActionNoticeCandidate {
  actionId: string;
  incidentId: string;
  projectId: string;
  incidentNumber: number;
  actionNumber: number;
  title: string;
  dueDate: string | null;
  recipients: string[];
}

export interface PlannedActionNotice {
  userId: string;
  projectId: string;
  incidentId: string;
  kind: 'safety.incident_action_assigned';
  title: string;
  body: string;
  dedupeKey: string;
}

/** Only recent actions are announced, so switching this on does not flood people with old ones. */
const WINDOW_DAYS = 3;

/**
 * Open corrective actions raised in the last few days. An action assigned to a person goes to that person; one
 * assigned to a company goes to the company's active members on the project. Whoever raised it is not told about
 * their own action. Reads under the job's tenant scope, so only this organisation's rows are seen.
 */
export async function findActionNotices(
  scope: TenantScope,
  now: Date,
): Promise<ActionNoticeCandidate[]> {
  const rows = await scope.tx.execute<{
    action_id: string;
    incident_id: string;
    project_id: string;
    incident_number: number;
    action_number: number;
    title: string;
    due_date: string | null;
    recipients: string[] | null;
  }>(sql`
    select a.id as action_id, a.incident_id, a.project_id, i.number as incident_number, a.number as action_number,
           a.title, to_char(a.due_date, 'YYYY-MM-DD') as due_date,
           array(
             select distinct pm.user_id::text from platform.project_members pm
              where pm.project_id = a.project_id and pm.status = 'active'
                and pm.user_id is distinct from a.created_by
                and ((a.assignee_user_id is not null and pm.user_id = a.assignee_user_id)
                  or (a.assignee_user_id is null and a.assignee_company_id is not null
                      and pm.company_id = a.assignee_company_id))
           ) as recipients
      from safety.incident_actions a
      join safety.incidents i on i.id = a.incident_id
     where a.status = 'open'
       and (a.assignee_user_id is not null or a.assignee_company_id is not null)
       and a.created_at > ${new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()}::timestamptz
  `);
  return rows.rows
    .filter((r) => (r.recipients ?? []).length > 0)
    .map((r) => ({
      actionId: r.action_id,
      incidentId: r.incident_id,
      projectId: r.project_id,
      incidentNumber: r.incident_number,
      actionNumber: r.action_number,
      title: r.title,
      dueDate: r.due_date,
      recipients: r.recipients ?? [],
    }));
}

/**
 * One inbox item per person per action. The text carries no injury or health detail: only the incident number, the
 * action's title and when it is due. Keyed by action and person so a rerun tells nobody twice.
 */
export function planActionNotices(
  candidates: readonly ActionNoticeCandidate[],
): PlannedActionNotice[] {
  return candidates.flatMap((c) =>
    c.recipients.map((userId) => ({
      userId,
      projectId: c.projectId,
      incidentId: c.incidentId,
      kind: 'safety.incident_action_assigned' as const,
      title: `${incidentLabel(c.incidentNumber)}: corrective action assigned to you`,
      body: `${c.title}${c.dueDate ? `. Due ${c.dueDate}.` : '.'}`,
      dedupeKey: `incident_action:${c.actionId}:assigned`,
    })),
  );
}
