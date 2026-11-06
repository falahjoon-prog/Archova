import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { daysBetween } from '@archova/time';
import { canMove, csvLine, editable, hoursOf, payable, type SheetState } from '../domain/timesheet';
import { attendanceSessions, timesheetLines, timesheets, workers } from '../infra/tables';
import type { AttendanceService } from './attendance';

export type SheetRow = typeof timesheets.$inferSelect;
export type LineRow = typeof timesheetLines.$inferSelect;
export interface Sheet {
  sheet: SheetRow;
  lines: LineRow[];
}

export interface TimesheetDeps {
  access: AccessService;
  attendance: Pick<AttendanceService, 'viewer'>;
  now?: () => Date;
}

const MAX_RANGE_DAYS = 62;

/**
 * Daily timesheets (ATT-US9): built from closed sign-ins, adjusted with a reason, submitted, approved by a
 * supervisor and then locked. Approved sheets export as CSV. A subcontractor sees and edits only its own workers.
 */
export function createTimesheetService(deps: TimesheetDeps) {
  const now = deps.now ?? (() => new Date());
  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  function checkRange(from: string, to: string) {
    if (to < from)
      throw new AppError('validation_failed', 'The range must not end before it starts.', [
        { path: 'to', message: 'Must be on or after the start' },
      ]);
    if (daysBetween(from, to) > MAX_RANGE_DAYS)
      throw new AppError('validation_failed', `Use a range of ${MAX_RANGE_DAYS} days or less.`, [
        { path: 'to', message: 'Range too long' },
      ]);
  }

  async function linesFor(scope: TenantScope, sheetIds: string[]) {
    if (sheetIds.length === 0) return [] as LineRow[];
    return scope.tx
      .select()
      .from(timesheetLines)
      .where(inArray(timesheetLines.timesheetId, sheetIds))
      .orderBy(asc(timesheetLines.createdAt), asc(timesheetLines.id));
  }

  async function load(
    scope: TenantScope,
    projectId: string,
    id: string,
    opts: { lock?: boolean } = {},
  ): Promise<Sheet> {
    const v = await deps.attendance.viewer(scope, projectId);
    const q = scope.tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.id, id), eq(timesheets.projectId, projectId)))
      .limit(1);
    const [sheet] = await (opts.lock ? q.for('update') : q);
    // A subcontractor can't tell another company's sheet exists.
    if (!sheet || (v.scopedCompanyId && sheet.companyId !== v.scopedCompanyId))
      throw new AppError('workforce_timesheet.not_found');
    return { sheet, lines: await linesFor(scope, [sheet.id]) };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { from: string; to: string; status?: SheetState; workerId?: string },
  ): Promise<Sheet[]> {
    await need(scope, 'workforce.timesheets.view', projectId);
    checkRange(opts.from, opts.to);
    const v = await deps.attendance.viewer(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(timesheets)
      .where(
        and(
          eq(timesheets.projectId, projectId),
          gte(timesheets.localDate, opts.from),
          lte(timesheets.localDate, opts.to),
          opts.status ? eq(timesheets.status, opts.status) : undefined,
          opts.workerId ? eq(timesheets.workerId, opts.workerId) : undefined,
          v.scopedCompanyId ? eq(timesheets.companyId, v.scopedCompanyId) : undefined,
        ),
      )
      .orderBy(asc(timesheets.localDate), asc(timesheets.workerId))
      .limit(1000);
    const lines = await linesFor(
      scope,
      rows.map((r) => r.id),
    );
    return rows.map((sheet) => ({ sheet, lines: lines.filter((l) => l.timesheetId === sheet.id) }));
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'workforce.timesheets.view', projectId);
    return load(scope, projectId, id);
  }

  /**
   * Fill draft sheets from closed sign-ins in a date range. Safe to run again: a session is added to a sheet once,
   * and a sheet that is no longer editable is left alone.
   */
  async function generate(
    scope: TenantScope,
    projectId: string,
    range: { from: string; to: string },
  ) {
    await need(scope, 'workforce.timesheets.edit', projectId);
    checkRange(range.from, range.to);
    const v = await deps.attendance.viewer(scope, projectId);
    const sessions = await scope.tx
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.projectId, projectId),
          gte(attendanceSessions.localDate, range.from),
          lte(attendanceSessions.localDate, range.to),
          isNotNull(attendanceSessions.minutes),
          inArray(attendanceSessions.status, ['off_site', 'auto_closed']),
          v.scopedCompanyId ? eq(attendanceSessions.companyId, v.scopedCompanyId) : undefined,
        ),
      )
      .orderBy(asc(attendanceSessions.localDate), asc(attendanceSessions.signedInAt));

    let sheetsCreated = 0;
    let linesAdded = 0;
    const byKey = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const k = `${s.workerId}|${s.localDate}`;
      byKey.set(k, [...(byKey.get(k) ?? []), s]);
    }
    for (const group of byKey.values()) {
      const first = group[0]!;
      const inserted = await scope.tx
        .insert(timesheets)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          workerId: first.workerId,
          companyId: first.companyId,
          localDate: first.localDate,
        })
        .onConflictDoNothing()
        .returning({ id: timesheets.id });
      if (inserted.length > 0) sheetsCreated++;
      const [sheet] = await scope.tx
        .select()
        .from(timesheets)
        .where(
          and(
            eq(timesheets.projectId, projectId),
            eq(timesheets.workerId, first.workerId),
            eq(timesheets.localDate, first.localDate),
          ),
        )
        .limit(1);
      if (!sheet || !editable(sheet.status as SheetState)) continue;
      const added = await scope.tx
        .insert(timesheetLines)
        .values(
          group.map((s) => ({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            timesheetId: sheet.id,
            minutes: Math.min(s.minutes ?? 0, 1440),
            source: 'attendance' as const,
            attendanceSessionId: s.id,
            createdBy: scope.ctx.userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: timesheetLines.id });
      linesAdded += added.length;
    }
    return { sheetsCreated, linesAdded };
  }

  function checkLine(minutes: number, breakMinutes: number) {
    if (breakMinutes > minutes)
      throw new AppError('validation_failed', 'The break can’t be longer than the time worked.', [
        { path: 'breakMinutes', message: 'Must not exceed the minutes worked' },
      ]);
  }

  async function addLine(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { minutes: number; breakMinutes?: number; costCodeId?: string; reason: string },
  ) {
    await need(scope, 'workforce.timesheets.edit', projectId);
    const { sheet } = await load(scope, projectId, id, { lock: true });
    if (!editable(sheet.status as SheetState))
      throw new AppError('workforce_timesheet.bad_state', `A ${sheet.status} timesheet is locked.`);
    checkLine(input.minutes, input.breakMinutes ?? 0);
    await scope.tx.insert(timesheetLines).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      timesheetId: sheet.id,
      minutes: input.minutes,
      breakMinutes: input.breakMinutes ?? 0,
      costCodeId: input.costCodeId ?? null,
      source: 'manual',
      adjustedReason: input.reason.trim(),
      createdBy: scope.ctx.userId,
    });
    return load(scope, projectId, id);
  }

  async function adjustLine(
    scope: TenantScope,
    projectId: string,
    id: string,
    lineId: string,
    patch: {
      minutes?: number;
      breakMinutes?: number;
      costCodeId?: string | null;
      reason: string;
    },
  ) {
    await need(scope, 'workforce.timesheets.edit', projectId);
    const { sheet, lines } = await load(scope, projectId, id, { lock: true });
    if (!editable(sheet.status as SheetState))
      throw new AppError('workforce_timesheet.bad_state', `A ${sheet.status} timesheet is locked.`);
    const line = lines.find((l) => l.id === lineId);
    if (!line) throw new AppError('workforce_timesheet.line_not_found');
    const minutes = patch.minutes ?? line.minutes;
    const breakMinutes = patch.breakMinutes ?? line.breakMinutes;
    checkLine(minutes, breakMinutes);
    await scope.tx
      .update(timesheetLines)
      .set({
        minutes,
        breakMinutes,
        ...(patch.costCodeId !== undefined ? { costCodeId: patch.costCodeId } : {}),
        source: line.source === 'manual' ? 'manual' : 'adjusted',
        adjustedReason: patch.reason.trim(),
      })
      .where(eq(timesheetLines.id, line.id));
    return load(scope, projectId, id);
  }

  async function move(
    scope: TenantScope,
    projectId: string,
    id: string,
    to: SheetState,
    key: string,
    extra: Partial<typeof timesheets.$inferInsert> = {},
  ) {
    await need(scope, key, projectId);
    const { sheet, lines } = await load(scope, projectId, id, { lock: true });
    if (!canMove(sheet.status as SheetState, to))
      throw new AppError(
        'workforce_timesheet.bad_state',
        `A ${sheet.status} timesheet can't be ${to}.`,
      );
    if (to === 'submitted' && lines.length === 0)
      throw new AppError('workforce_timesheet.bad_state', 'Add hours before submitting.');
    await scope.tx
      .update(timesheets)
      .set({ status: to, version: sheet.version + 1, ...extra })
      .where(eq(timesheets.id, sheet.id));
    if (to === 'approved')
      scope.events.add({
        type: 'workforce.timesheet.approved.v1',
        projectId,
        entityType: 'timesheet',
        entityId: sheet.id,
        entityVersion: sheet.version + 1,
        data: { timesheetId: sheet.id, workerId: sheet.workerId, localDate: sheet.localDate },
      });
    return load(scope, projectId, id);
  }

  const submit = (scope: TenantScope, projectId: string, id: string) =>
    move(scope, projectId, id, 'submitted', 'workforce.timesheets.edit', {
      submittedAt: now(),
      rejectionReason: null,
    });

  const approve = (scope: TenantScope, projectId: string, id: string) =>
    move(scope, projectId, id, 'approved', 'workforce.timesheets.approve', {
      approvedBy: scope.ctx.userId,
      approvedAt: now(),
    });

  const reject = (scope: TenantScope, projectId: string, id: string, reason: string) =>
    move(scope, projectId, id, 'rejected', 'workforce.timesheets.approve', {
      rejectionReason: reason.trim(),
    });

  /** CSV of approved sheets in a range, one row per line. They are marked exported so they aren't paid twice. */
  async function exportCsv(
    scope: TenantScope,
    projectId: string,
    range: { from: string; to: string },
  ) {
    await need(scope, 'workforce.timesheets.export', projectId);
    checkRange(range.from, range.to);
    const v = await deps.attendance.viewer(scope, projectId);
    const sheets = await scope.tx
      .select({ sheet: timesheets, workerName: workers.fullName })
      .from(timesheets)
      .innerJoin(workers, eq(workers.id, timesheets.workerId))
      .where(
        and(
          eq(timesheets.projectId, projectId),
          eq(timesheets.status, 'approved'),
          gte(timesheets.localDate, range.from),
          lte(timesheets.localDate, range.to),
          v.scopedCompanyId ? eq(timesheets.companyId, v.scopedCompanyId) : undefined,
        ),
      )
      .orderBy(asc(timesheets.localDate), asc(workers.fullName))
      // Not `of timesheets`: Postgres wants an unqualified name there and drizzle prints the schema.
      .for('update');
    const lines = await linesFor(
      scope,
      sheets.map((s) => s.sheet.id),
    );
    const out = [
      csvLine([
        'date',
        'worker',
        'minutes',
        'break_minutes',
        'paid_hours',
        'cost_code_id',
        'source',
        'reason',
      ]),
    ];
    for (const { sheet, workerName } of sheets)
      for (const l of lines.filter((x) => x.timesheetId === sheet.id))
        out.push(
          csvLine([
            sheet.localDate,
            workerName,
            String(l.minutes),
            String(l.breakMinutes),
            hoursOf(payable(l)),
            l.costCodeId ?? '',
            l.source,
            l.adjustedReason ?? '',
          ]),
        );
    if (sheets.length > 0)
      await scope.tx
        .update(timesheets)
        .set({ status: 'exported', exportedAt: now() })
        .where(
          inArray(
            timesheets.id,
            sheets.map((s) => s.sheet.id),
          ),
        );
    return {
      filename: `timesheets-${range.from}-to-${range.to}.csv`,
      csv: `${out.join('\r\n')}\r\n`,
      count: sheets.length,
    };
  }

  /**
   * Worked minutes per cost code on a project (break taken off), from submitted, approved or exported sheets: a draft
   * is still being filled in and a rejected one is being redone. Lines with no cost code come back under `null`.
   * For the labor productivity report in `financials`.
   */
  async function minutesByCostCode(scope: TenantScope, projectId: string) {
    await need(scope, 'workforce.timesheets.view', projectId);
    const rows = await scope.tx
      .select({
        costCodeId: timesheetLines.costCodeId,
        minutes: sql<string>`sum(${timesheetLines.minutes} - ${timesheetLines.breakMinutes})`,
      })
      .from(timesheetLines)
      .innerJoin(timesheets, eq(timesheets.id, timesheetLines.timesheetId))
      .where(
        and(
          eq(timesheets.projectId, projectId),
          inArray(timesheets.status, ['submitted', 'approved', 'exported']),
        ),
      )
      .groupBy(timesheetLines.costCodeId);
    return rows.map((r) => ({ costCodeId: r.costCodeId, minutes: Number(r.minutes) }));
  }

  return {
    list,
    get,
    generate,
    addLine,
    adjustLine,
    submit,
    approve,
    reject,
    exportCsv,
    minutesByCostCode,
  };
}

export type TimesheetService = ReturnType<typeof createTimesheetService>;
