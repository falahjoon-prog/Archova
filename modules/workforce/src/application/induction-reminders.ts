import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { localDateOf, type LocalDate } from '@archova/time';
import { reminderText, reminderThreshold, type ReminderThreshold } from '../domain/induction';

export interface InductionReminderCandidate {
  completionId: string;
  inductionId: string;
  projectId: string;
  workerName: string;
  workerUserId: string | null;
  /** Whoever built and published the site induction: the site team to tell. */
  ownerUserIds: string[];
  expiresOn: string;
  threshold: ReminderThreshold;
}

export interface InductionReminderNotice {
  userId: string;
  projectId: string;
  inductionId: string;
  kind: string;
  title: string;
  body: string;
  dedupeKey: string;
}

/**
 * Signed inductions that run out within 30 days (or have), one per worker and induction: the newest signed one, and
 * only when the worker has no redo under way. The most urgent step (30, 7 or 0 days) is the candidate; the day is the
 * project's own. Recording the step makes it one-shot however often this runs, and a redo (new expiry) re-arms it.
 */
export async function findInductionReminders(
  scope: TenantScope,
  now: Date,
): Promise<InductionReminderCandidate[]> {
  const { rows } = await scope.tx.execute<{
    completion_id: string;
    induction_id: string;
    project_id: string;
    full_name: string;
    user_id: string | null;
    expires_on: string;
    timezone: string;
    owners: string[];
  }>(sql`
    select distinct on (c.induction_id, c.worker_id)
           c.id::text as completion_id, c.induction_id::text, c.project_id::text, w.full_name,
           w.user_id::text, c.expires_on::text as expires_on, pr.timezone,
           array_remove(array[i.created_by::text, i.updated_by::text], null) as owners
      from workforce.induction_completions c
      join workforce.inductions i on i.id = c.induction_id and i.status = 'published'
      join workforce.workers w on w.id = c.worker_id and w.kind = 'worker'
      join platform.projects pr on pr.id = c.project_id
     where c.status = 'completed' and c.expires_on is not null
       and not exists (
         select 1 from workforce.induction_completions r
          where r.induction_id = c.induction_id and r.worker_id = c.worker_id and r.status = 'in_progress')
     order by c.induction_id, c.worker_id, c.completed_at desc, c.cycle desc`);
  const out: InductionReminderCandidate[] = [];
  for (const r of rows) {
    const today: LocalDate = localDateOf(now, r.timezone);
    const threshold = reminderThreshold(r.expires_on, today);
    if (threshold === null) continue;
    out.push({
      completionId: r.completion_id,
      inductionId: r.induction_id,
      projectId: r.project_id,
      workerName: r.full_name,
      workerUserId: r.user_id,
      ownerUserIds: [...new Set(r.owners)],
      expiresOn: r.expires_on,
      threshold,
    });
  }
  return out;
}

/** Who is told what: the worker (if they have a login) and the site team that owns the induction. */
export function planInductionReminders(
  candidates: InductionReminderCandidate[],
): InductionReminderNotice[] {
  return candidates.flatMap((c) => {
    const key = `induction-expiry:${c.completionId}:${c.threshold}:${c.expiresOn}`;
    const kind = c.threshold === 0 ? 'workforce.induction_expired' : 'workforce.induction_expiring';
    const notice = (
      userId: string,
      audience: 'worker' | 'supervisor',
    ): InductionReminderNotice => ({
      userId,
      projectId: c.projectId,
      inductionId: c.inductionId,
      kind,
      ...reminderText(c.workerName, c.threshold, c.expiresOn, audience),
      dedupeKey: `${key}:${userId}`,
    });
    return [
      ...(c.workerUserId ? [notice(c.workerUserId, 'worker')] : []),
      ...c.ownerUserIds.filter((u) => u !== c.workerUserId).map((u) => notice(u, 'supervisor')),
    ];
  });
}
