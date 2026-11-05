import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { canMove, filled, overlaps, type AssignmentState } from '../domain/roster';
import { shiftAssignments, shifts, workers } from '../infra/tables';
import type { AttendanceService } from './attendance';

export type ShiftRow = typeof shifts.$inferSelect;
export type AssignmentRow = typeof shiftAssignments.$inferSelect;

export interface CreateShiftInput {
  siteId: string;
  crew?: string;
  trade: string;
  note?: string;
  startsAt: Date;
  endsAt: Date;
  requiredHeadcount: number;
}

export interface RosterDeps {
  access: AccessService;
  attendance: Pick<AttendanceService, 'viewer' | 'getSite' | 'getWorker'>;
  now?: () => Date;
}

/**
 * Rosters (ATT-US11): shifts at a site and the workers offered to them. Site managers build, publish and cancel;
 * a subcontractor (company-scoped) sees only its own workers' assignments and answers for them.
 */
export function createRosterService(deps: RosterDeps) {
  const now = deps.now ?? (() => new Date());
  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  async function shiftRow(scope: TenantScope, projectId: string, shiftId: string, lock = false) {
    const q = scope.tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, shiftId), eq(shifts.projectId, projectId)))
      .limit(1);
    const [row] = await (lock ? q.for('update') : q);
    if (!row) throw new AppError('workforce_shift.not_found');
    return row;
  }

  /** A subcontractor sees only its own workers' assignments; everyone with roster access sees every shift. */
  async function assignmentsFor(scope: TenantScope, projectId: string, shiftIds: string[]) {
    if (shiftIds.length === 0) return [] as AssignmentRow[];
    const v = await deps.attendance.viewer(scope, projectId);
    return scope.tx
      .select()
      .from(shiftAssignments)
      .where(
        and(
          inArray(shiftAssignments.shiftId, shiftIds),
          v.scopedCompanyId ? eq(shiftAssignments.companyId, v.scopedCompanyId) : undefined,
        ),
      )
      .orderBy(asc(shiftAssignments.createdAt), asc(shiftAssignments.id));
  }

  async function filledCounts(scope: TenantScope, shiftIds: string[]) {
    const out = new Map<string, number>();
    if (shiftIds.length === 0) return out;
    const rows = await scope.tx
      .select({ shiftId: shiftAssignments.shiftId, status: shiftAssignments.status })
      .from(shiftAssignments)
      .where(inArray(shiftAssignments.shiftId, shiftIds));
    for (const id of shiftIds)
      out.set(
        id,
        filled(rows.filter((r) => r.shiftId === id).map((r) => r.status as AssignmentState)),
      );
    return out;
  }

  async function createShift(scope: TenantScope, projectId: string, input: CreateShiftInput) {
    await need(scope, 'workforce.rosters.manage', projectId);
    await deps.attendance.getSite(scope, projectId, input.siteId);
    if (input.endsAt <= input.startsAt)
      throw new AppError('validation_failed', 'A shift must end after it starts.', [
        { path: 'endsAt', message: 'Must be after the start' },
      ]);
    const [row] = await scope.tx
      .insert(shifts)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        siteId: input.siteId,
        crew: input.crew?.trim() || null,
        trade: input.trade.trim(),
        note: input.note?.trim() || null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        requiredHeadcount: input.requiredHeadcount,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return { shift: row!, assignments: [] as AssignmentRow[], filled: 0 };
  }

  async function listShifts(
    scope: TenantScope,
    projectId: string,
    opts: { from?: Date; to?: Date; siteId?: string; status?: ShiftRow['status'] },
  ) {
    await need(scope, 'workforce.rosters.view', projectId);
    const manager = await deps.access.can(scope, 'workforce.rosters.manage', { projectId });
    const rows = await scope.tx
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.projectId, projectId),
          // Drafts are the site manager's working copy.
          manager ? undefined : ne(shifts.status, 'draft'),
          opts.from ? gte(shifts.endsAt, opts.from) : undefined,
          opts.to ? lt(shifts.startsAt, opts.to) : undefined,
          opts.siteId ? eq(shifts.siteId, opts.siteId) : undefined,
          opts.status ? eq(shifts.status, opts.status) : undefined,
        ),
      )
      .orderBy(asc(shifts.startsAt), asc(shifts.id))
      .limit(500);
    const ids = rows.map((r) => r.id);
    const [assignments, counts] = await Promise.all([
      assignmentsFor(scope, projectId, ids),
      filledCounts(scope, ids),
    ]);
    return rows.map((shift) => ({
      shift,
      assignments: assignments.filter((a) => a.shiftId === shift.id),
      filled: counts.get(shift.id) ?? 0,
    }));
  }

  async function getShift(scope: TenantScope, projectId: string, shiftId: string) {
    await need(scope, 'workforce.rosters.view', projectId);
    const shift = await shiftRow(scope, projectId, shiftId);
    if (
      shift.status === 'draft' &&
      !(await deps.access.can(scope, 'workforce.rosters.manage', { projectId }))
    )
      throw new AppError('workforce_shift.not_found');
    const [assignments, counts] = await Promise.all([
      assignmentsFor(scope, projectId, [shift.id]),
      filledCounts(scope, [shift.id]),
    ]);
    return { shift, assignments, filled: counts.get(shift.id) ?? 0 };
  }

  async function publishShift(scope: TenantScope, projectId: string, shiftId: string) {
    await need(scope, 'workforce.rosters.manage', projectId);
    const shift = await shiftRow(scope, projectId, shiftId, true);
    if (shift.status !== 'draft')
      throw new AppError(
        'workforce_shift.bad_state',
        `A ${shift.status} shift can't be published.`,
      );
    const at = now();
    const [row] = await scope.tx
      .update(shifts)
      .set({ status: 'published', publishedAt: at, version: shift.version + 1 })
      .where(eq(shifts.id, shift.id))
      .returning();
    // Everyone already assigned is now offered the shift.
    await scope.tx
      .update(shiftAssignments)
      .set({ notifiedAt: at })
      .where(eq(shiftAssignments.shiftId, shift.id));
    scope.events.add({
      type: 'workforce.shift.published.v1',
      projectId,
      entityType: 'shift',
      entityId: shift.id,
      entityVersion: row!.version,
      data: { shiftId: shift.id, siteId: shift.siteId, startsAt: shift.startsAt.toISOString() },
    });
    return getShift(scope, projectId, shift.id);
  }

  async function cancelShift(scope: TenantScope, projectId: string, shiftId: string) {
    await need(scope, 'workforce.rosters.manage', projectId);
    const shift = await shiftRow(scope, projectId, shiftId, true);
    if (shift.status === 'cancelled')
      throw new AppError('workforce_shift.bad_state', 'This shift is already cancelled.');
    const [row] = await scope.tx
      .update(shifts)
      .set({ status: 'cancelled', version: shift.version + 1 })
      .where(eq(shifts.id, shift.id))
      .returning();
    if (shift.status === 'published')
      scope.events.add({
        type: 'workforce.shift.cancelled.v1',
        projectId,
        entityType: 'shift',
        entityId: shift.id,
        entityVersion: row!.version,
        data: { shiftId: shift.id, siteId: shift.siteId, startsAt: shift.startsAt.toISOString() },
      });
    return getShift(scope, projectId, shift.id);
  }

  async function assign(
    scope: TenantScope,
    projectId: string,
    shiftId: string,
    workerIds: string[],
  ) {
    await need(scope, 'workforce.rosters.manage', projectId);
    const shift = await shiftRow(scope, projectId, shiftId, true);
    if (shift.status === 'cancelled')
      throw new AppError('workforce_shift.bad_state', "Cancelled shifts can't take workers.");
    const unique = [...new Set(workerIds)];
    const people = [];
    for (const id of unique) people.push(await deps.attendance.getWorker(scope, id));
    for (const w of people) {
      if (w.status !== 'active' || w.kind !== 'worker')
        throw new AppError('validation_failed', `${w.fullName} can't be rostered.`, [
          { path: 'workerIds', message: 'Only active workers can be rostered' },
        ]);
      // One person can't be on two overlapping shifts anywhere in the org.
      const others = await scope.tx
        .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt })
        .from(shiftAssignments)
        .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
        .where(
          and(
            eq(shiftAssignments.workerId, w.id),
            ne(shiftAssignments.shiftId, shift.id),
            ne(shifts.status, 'cancelled'),
            ne(shiftAssignments.status, 'declined'),
            lt(shifts.startsAt, shift.endsAt),
            gte(shifts.endsAt, shift.startsAt),
          ),
        );
      if (others.some((o) => overlaps(o, shift)))
        throw new AppError(
          'workforce_shift.worker_conflict',
          `${w.fullName} is already rostered on an overlapping shift.`,
        );
    }
    const at = now();
    await scope.tx
      .insert(shiftAssignments)
      .values(
        people.map((w) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          shiftId: shift.id,
          workerId: w.id,
          companyId: w.companyId,
          notifiedAt: shift.status === 'published' ? at : null,
          createdBy: scope.ctx.userId,
        })),
      )
      .onConflictDoNothing();
    return getShift(scope, projectId, shift.id);
  }

  async function assignmentRow(scope: TenantScope, projectId: string, shiftId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(shiftAssignments)
      .where(
        and(
          eq(shiftAssignments.id, id),
          eq(shiftAssignments.shiftId, shiftId),
          eq(shiftAssignments.projectId, projectId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('workforce_shift.assignment_not_found');
    return row;
  }

  async function unassign(scope: TenantScope, projectId: string, shiftId: string, id: string) {
    await need(scope, 'workforce.rosters.manage', projectId);
    const shift = await shiftRow(scope, projectId, shiftId, true);
    const a = await assignmentRow(scope, projectId, shiftId, id);
    if (a.status === 'attended' || a.status === 'no_show')
      throw new AppError(
        'workforce_shift.bad_state',
        'Attendance is already recorded for this worker.',
      );
    await scope.tx.delete(shiftAssignments).where(eq(shiftAssignments.id, a.id));
    return getShift(scope, projectId, shift.id);
  }

  async function respond(
    scope: TenantScope,
    projectId: string,
    shiftId: string,
    id: string,
    to: AssignmentState,
  ) {
    await need(scope, 'workforce.rosters.view', projectId);
    const v = await deps.attendance.viewer(scope, projectId);
    const manager = await deps.access.can(scope, 'workforce.rosters.manage', { projectId });
    const shift = await shiftRow(scope, projectId, shiftId, true);
    if (shift.status !== 'published')
      throw new AppError('workforce_shift.bad_state', 'Only a published shift can be answered.');
    const a = await assignmentRow(scope, projectId, shiftId, id);
    // A subcontractor answers only for its own workers.
    if (v.scopedCompanyId && a.companyId !== v.scopedCompanyId)
      throw new AppError('workforce_shift.assignment_not_found');
    if (!manager && v.scopedCompanyId === null) {
      // A member without manage rights can answer for themselves only.
      const [w] = await scope.tx.select().from(workers).where(eq(workers.id, a.workerId));
      if (!w || w.userId !== scope.ctx.userId)
        throw new AppError('access.denied', 'You can only answer for yourself.');
    }
    const started = shift.startsAt <= now();
    if (!canMove(a.status as AssignmentState, to, manager ? 'manager' : 'worker', started))
      throw new AppError(
        'workforce_shift.bad_state',
        `That can't change from ${a.status} to ${to}.`,
      );
    await scope.tx
      .update(shiftAssignments)
      .set({ status: to, respondedAt: now() })
      .where(eq(shiftAssignments.id, a.id));
    return getShift(scope, projectId, shift.id);
  }

  return {
    createShift,
    listShifts,
    getShift,
    publishShift,
    cancelShift,
    assign,
    unassign,
    respond,
  };
}

export type RosterService = ReturnType<typeof createRosterService>;
