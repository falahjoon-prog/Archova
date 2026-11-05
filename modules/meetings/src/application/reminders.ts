import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { addDays, compareLocalDates, type LocalDate } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { items, meetings, sections } from '../infra/tables';

/** How long past its date an action still gets its "overdue" reminder; older ones were already chased or are stale. */
export const OVERDUE_WINDOW_DAYS = 14;

export interface ReminderCandidate {
  threadId: string;
  meetingId: string;
  projectId: string;
  ownerUserId: string;
  itemNo: string;
  body: string;
  meetingTitle: string;
  dueDate: LocalDate;
  internalOnly: boolean;
  /** The action has appeared in an issued set of minutes, so its owner has been sent it (MTG-AC7). */
  issued: boolean;
}

export type ReminderKind = 'meeting.action_due_soon' | 'meeting.action_overdue';

export interface PlannedReminder {
  userId: string;
  projectId: string;
  meetingId: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** One per action thread, stage and due date: a carried copy never re-reminds, a moved due date does. */
  dedupeKey: string;
}

/**
 * Open actions owned by a named person, due within a day or overdue by up to two weeks (MTG-AC3). `today` is the
 * widest day any project could be on, so the rows are a superset; `planReminders` applies each project's own day.
 */
export async function findReminderCandidates(
  scope: TenantScope,
  now: Date,
): Promise<ReminderCandidate[]> {
  const utcDay: LocalDate = now.toISOString().slice(0, 10);
  const rows = await scope.tx
    .select({
      threadId: items.threadId,
      meetingId: items.meetingId,
      projectId: items.projectId,
      ownerUserId: items.ownerUserId,
      itemNo: items.itemNo,
      body: items.body,
      dueDate: items.dueDate,
      meetingTitle: meetings.title,
      internalOnly: sections.internalOnly,
      issued: sql<boolean>`exists (
        select 1 from meetings.items x join meetings.meetings xm on xm.id = x.meeting_id
        where x.thread_id = ${items.threadId} and xm.status = 'issued' and xm.deleted_at is null)`,
    })
    .from(items)
    .innerJoin(meetings, eq(items.meetingId, meetings.id))
    .innerJoin(sections, eq(items.sectionId, sections.id))
    .where(
      and(
        eq(items.kind, 'action'),
        eq(items.status, 'open'),
        isNull(items.deletedAt),
        isNull(meetings.deletedAt),
        sql`${items.ownerUserId} is not null`,
        gte(items.dueDate, addDays(utcDay, -(OVERDUE_WINDOW_DAYS + 1))),
        lte(items.dueDate, addDays(utcDay, 2)),
        // An open action is carried into every later meeting; the live copy is the one in the series' latest meeting.
        sql`${meetings.number} = (select max(m2.number) from meetings.meetings m2
              where m2.series_id = ${meetings.seriesId} and m2.deleted_at is null)`,
      ),
    )
    .limit(5000);
  return rows.map((r) => ({ ...r, ownerUserId: r.ownerUserId!, dueDate: r.dueDate! }));
}

/**
 * Decides who is told what. Pure. `todayOf` is the project's own local day (null drops the row); `isMember` is true
 * for people on the builder's own team. A subcontractor or client only hears about an action in minutes that were
 * issued to them and never about an internal-only section; the team hears about any open action they own.
 */
export function planReminders(
  candidates: readonly ReminderCandidate[],
  ctx: {
    todayOf: (projectId: string) => LocalDate | null;
    isMember: (userId: string) => boolean;
  },
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const c of candidates) {
    const today = ctx.todayOf(c.projectId);
    if (!today) continue;
    const visible = ctx.isMember(c.ownerUserId) || (c.issued && !c.internalOnly);
    if (!visible) continue;
    let kind: ReminderKind;
    if (compareLocalDates(c.dueDate, today) < 0) {
      if (compareLocalDates(c.dueDate, addDays(today, -OVERDUE_WINDOW_DAYS)) < 0) continue;
      kind = 'meeting.action_overdue';
    } else if (compareLocalDates(c.dueDate, addDays(today, 1)) <= 0) {
      kind = 'meeting.action_due_soon';
    } else continue;
    const what = c.body.length > 120 ? `${c.body.slice(0, 117)}...` : c.body;
    out.push({
      userId: c.ownerUserId,
      projectId: c.projectId,
      meetingId: c.meetingId,
      kind,
      title:
        kind === 'meeting.action_overdue'
          ? `Action ${c.itemNo} is overdue`
          : c.dueDate === today
            ? `Action ${c.itemNo} is due today`
            : `Action ${c.itemNo} is due tomorrow`,
      body: `${c.meetingTitle}: ${what}`,
      dedupeKey: `meeting-action:${c.threadId}:${kind}:${c.dueDate}`,
    });
  }
  return out;
}
