import { and, asc, desc, eq, gte, inArray, isNotNull, lte, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { localDateOf } from '@archova/time';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { dayProblem, isEditable, totals, TRANSITIONS, MAX_DAY_MINUTES } from '../domain/timesheet';
import {
  attendanceSessions,
  timesheetLines,
  timesheets,
  workers,
  type TimesheetStatus,
} from '../infra/tables';
import type { WorkforceDeps } from './attendance';

export type TimesheetRow = typeof timesheets.$inferSelect;
export type TimesheetLineRow = typeof timesheetLines.$inferSelect;

export interface TimesheetEntry {
  sheet: TimesheetRow;
  workerName: string;
  workerUserId: string | null;
  lines: TimesheetLineRow[];
}

export interface TimesheetFilters {
  from?: string;
  to?: string;
  status?: TimesheetStatus;
  workerId?: string;
  companyId?: string;
}

export interface LineInput {
  minutes: number;
  breakMinutes?: number;
  reason: string;
}

const NO_COMPANY = '00000000-0000-0000-0000-000000000000';
const LIST_LIMIT = 200;

/** Daily timesheets built from sign-ins, adjusted with a reason, approved by a supervisor (ATT-US9). */
export function createTimesheetService(deps: WorkforceDeps) {
  const now = deps.now ?? (() => new Date());

  /** A subcontractor sees only their own company's timesheets (company-scoped tool). */
  async function scopedCompany(scope: TenantScope, projectId: string): Promise<string | null> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    const orgAdmin = perms.orgRole === 'owner' || perms.orgRole === 'admin';
    const scoped = !orgAdmin && perms.companyScopedTools.includes('workforce');
    return scoped ? (perms.companyId ?? NO_COMPANY) : null;
  }

  async function hydrate(scope: TenantScope, rows: TimesheetRow[]): Promise<TimesheetEntry[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [lines, people] = await Promise.all([
      scope.tx
        .select()
        .from(timesheetLines)
        .where(inArray(timesheetLines.timesheetId, ids))
        .orderBy(asc(timesheetLines.createdAt), asc(timesheetLines.id)),
      scope.tx
        .select({ id: workers.id, name: workers.fullName, userId: workers.userId })
        .from(workers)
        .where(
          inArray(
            workers.id,
            rows.map((r) => r.workerId),
          ),
        ),
    ]);
    const byWorker = new Map(people.map((p) => [p.id, p]));
    return rows.map((sheet) => ({
      sheet,
      workerName: byWorker.get(sheet.workerId)?.name ?? 'Worker',
      workerUserId: byWorker.get(sheet.workerId)?.userId ?? null,
      lines: lines.filter((l) => l.timesheetId === sheet.id),
    }));
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    f: TimesheetFilters,
  ): Promise<TimesheetEntry[]> {
    const company = await scopedCompany(scope, projectId);
    const where: SQL[] = [eq(timesheets.projectId, projectId)];
    if (f.from) where.push(gte(timesheets.localDate, f.from));
    if (f.to) where.push(lte(timesheets.localDate, f.to));
    if (f.status) where.push(eq(timesheets.status, f.status));
    if (f.workerId) where.push(eq(timesheets.workerId, f.workerId));
    if (company) where.push(eq(timesheets.companyId, company));
    else if (f.companyId) where.push(eq(timesheets.companyId, f.companyId));
    const rows = await scope.tx
      .select()
      .from(timesheets)
      .where(and(...where))
      .orderBy(desc(timesheets.localDate), asc(timesheets.id))
      .limit(LIST_LIMIT);
    return hydrate(scope, rows);
  }

  async function load(scope: TenantScope, projectId: string, id: string): Promise<TimesheetEntry> {
    const company = await scopedCompany(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.id, id), eq(timesheets.projectId, projectId)));
    // A company never learns that another company's timesheet exists.
    if (!row || (company && row.companyId !== company)) throw new AppError('timesheet.not_found');
    return (await hydrate(scope, [row]))[0]!;
  }

  /** Builds the day's drafts from closed sign-in sessions. Existing timesheets are only topped up while editable. */
  async function generate(scope: TenantScope, projectId: string, date: string) {
    const project = await deps.platform.getProject(scope, projectId);
    if (date > localDateOf(now(), project.timezone)) throw new AppError('timesheet.future_date');
    const sessions = await scope.tx
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.projectId, projectId),
          eq(attendanceSessions.localDate, date),
          isNotNull(attendanceSessions.signedOutAt),
          isNotNull(attendanceSessions.minutes),
        ),
      )
      .orderBy(asc(attendanceSessions.signedInAt), asc(attendanceSessions.id));
    const byWorker = new Map<string, typeof sessions>();
    for (const s of sessions) byWorker.set(s.workerId, [...(byWorker.get(s.workerId) ?? []), s]);
    for (const [workerId, mine] of byWorker) {
      let [sheet] = await scope.tx
        .select()
        .from(timesheets)
        .where(
          and(
            eq(timesheets.workerId, workerId),
            eq(timesheets.projectId, projectId),
            eq(timesheets.localDate, date),
          ),
        );
      if (!sheet) {
        [sheet] = await scope.tx
          .insert(timesheets)
          .values({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            workerId,
            companyId: mine[0]!.companyId,
            localDate: date,
            createdBy: scope.ctx.userId,
            updatedBy: scope.ctx.userId,
          })
          .returning();
      }
      if (!sheet || !isEditable(sheet.status)) continue;
      const have = await scope.tx
        .select()
        .from(timesheetLines)
        .where(eq(timesheetLines.timesheetId, sheet.id));
      const covered = new Set(have.map((l) => l.attendanceSessionId).filter(Boolean));
      let running = totals(have).totalMinutes;
      let added = 0;
      for (const s of mine) {
        if (covered.has(s.id)) continue;
        const minutes = Math.min(s.minutes ?? 0, MAX_DAY_MINUTES - running);
        if (minutes <= 0) continue;
        await scope.tx.insert(timesheetLines).values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          timesheetId: sheet.id,
          projectId,
          minutes,
          source: 'attendance',
          attendanceSessionId: s.id,
          createdBy: scope.ctx.userId,
        });
        running += minutes;
        added += 1;
      }
      if (added > 0) await bump(scope, sheet, {});
    }
    return list(scope, projectId, { from: date, to: date });
  }

  async function bump(scope: TenantScope, sheet: TimesheetRow, patch: Partial<TimesheetRow>) {
    const [row] = await scope.tx
      .update(timesheets)
      .set({ ...patch, version: sheet.version + 1, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(and(eq(timesheets.id, sheet.id), eq(timesheets.version, sheet.version)))
      .returning();
    if (!row) throw versionConflict();
    return row;
  }

  async function editable(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
  ): Promise<TimesheetEntry> {
    const entry = await load(scope, projectId, id);
    if (entry.sheet.version !== expectedVersion) throw versionConflict();
    if (!isEditable(entry.sheet.status)) throw new AppError('timesheet.locked');
    return entry;
  }

  function checkDay(lines: Array<{ minutes: number; breakMinutes: number }>) {
    const problem = dayProblem(lines);
    if (problem === 'day_too_long') throw new AppError('timesheet.day_too_long');
    if (problem === 'break_too_long')
      throw new AppError('validation_failed', 'A break cannot be longer than the time worked.', [
        { path: 'breakMinutes', message: 'Longer than the time worked' },
      ]);
  }

  async function addLine(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: LineInput,
  ) {
    const entry = await editable(scope, projectId, id, expectedVersion);
    const breakMinutes = input.breakMinutes ?? 0;
    checkDay([...entry.lines, { minutes: input.minutes, breakMinutes }]);
    await scope.tx.insert(timesheetLines).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      timesheetId: id,
      projectId,
      minutes: input.minutes,
      breakMinutes,
      source: 'manual',
      adjustedReason: input.reason.trim(),
      createdBy: scope.ctx.userId,
    });
    await bump(scope, entry.sheet, {});
    return load(scope, projectId, id);
  }

  async function lineOf(entry: TimesheetEntry, lineId: string) {
    const line = entry.lines.find((l) => l.id === lineId);
    if (!line) throw new AppError('timesheet_line.not_found');
    return line;
  }

  async function updateLine(
    scope: TenantScope,
    projectId: string,
    id: string,
    lineId: string,
    expectedVersion: number,
    input: LineInput,
  ) {
    const entry = await editable(scope, projectId, id, expectedVersion);
    const line = await lineOf(entry, lineId);
    const breakMinutes = input.breakMinutes ?? 0;
    checkDay(
      entry.lines.map((l) => (l.id === lineId ? { minutes: input.minutes, breakMinutes } : l)),
    );
    await scope.tx
      .update(timesheetLines)
      .set({
        minutes: input.minutes,
        breakMinutes,
        // A hand-added line stays manual; a line from a sign-in is now adjusted.
        source: line.source === 'manual' ? 'manual' : 'adjusted',
        adjustedReason: input.reason.trim(),
        updatedAt: now(),
      })
      .where(eq(timesheetLines.id, lineId));
    await bump(scope, entry.sheet, {});
    return load(scope, projectId, id);
  }

  async function deleteLine(
    scope: TenantScope,
    projectId: string,
    id: string,
    lineId: string,
    expectedVersion: number,
  ) {
    const entry = await editable(scope, projectId, id, expectedVersion);
    const line = await lineOf(entry, lineId);
    if (line.source !== 'manual')
      throw new AppError('validation_failed', 'Lines from a sign-in are adjusted, not removed.', [
        { path: 'lineId', message: 'Adjust it instead' },
      ]);
    await scope.tx.delete(timesheetLines).where(eq(timesheetLines.id, lineId));
    await bump(scope, entry.sheet, {});
    return load(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    action: keyof typeof TRANSITIONS,
    reason?: string,
  ) {
    const entry = await load(scope, projectId, id);
    if (entry.sheet.version !== expectedVersion) throw versionConflict();
    const rule = TRANSITIONS[action];
    if (!(rule.from as readonly TimesheetStatus[]).includes(entry.sheet.status))
      throw new AppError(action === 'submit' ? 'timesheet.locked' : 'timesheet.not_submitted');
    if (action === 'submit' && entry.lines.length === 0) throw new AppError('timesheet.empty');
    // A supervisor cannot approve their own hours.
    if (action === 'approve' && entry.workerUserId && entry.workerUserId === scope.ctx.userId)
      throw new AppError('timesheet.own_timesheet');
    const at = now();
    await bump(
      scope,
      entry.sheet,
      action === 'submit'
        ? {
            status: rule.to,
            submittedAt: at,
            submittedBy: scope.ctx.userId,
            decidedAt: null,
            decidedBy: null,
            rejectionReason: null,
          }
        : {
            status: rule.to,
            decidedAt: at,
            decidedBy: scope.ctx.userId,
            rejectionReason: action === 'reject' ? (reason?.trim() ?? null) : null,
          },
    );
    return load(scope, projectId, id);
  }

  return {
    list,
    get: load,
    generate,
    addLine,
    updateLine,
    deleteLine,
    submit: (s: TenantScope, p: string, id: string, v: number) => transition(s, p, id, v, 'submit'),
    approve: (s: TenantScope, p: string, id: string, v: number) =>
      transition(s, p, id, v, 'approve'),
    reject: (s: TenantScope, p: string, id: string, v: number, reason: string) =>
      transition(s, p, id, v, 'reject', reason),
  };
}

export type TimesheetService = ReturnType<typeof createTimesheetService>;
