import { and, asc, desc, eq, gte, isNull, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import {
  isPointOverdue,
  isTrendingToBreach,
  judgeReading,
  type MonitoringFrequency,
  type Parameter,
  type ReadingStatus,
} from '../domain/monitoring';
import { conditions, monitoringPoints, readings } from '../infra/tables';
import type { ConditionService } from './conditions';
import { checkFiles, type EnvironmentDeps } from './shared';

export type PointRow = typeof monitoringPoints.$inferSelect;
export type ReadingRow = typeof readings.$inferSelect;

/** The reading's numbers as JS numbers (Postgres `numeric` comes back as a string). */
export interface Reading extends Omit<ReadingRow, 'value'> {
  value: number;
}

export interface PointView {
  point: PointRow;
  minLimit: number | null;
  maxLimit: number | null;
  warnMargin: number;
  latest: Reading | null;
  /** Newest last, for a sparkline. */
  recent: number[];
  openBreaches: number;
  isOverdue: boolean;
  isTrending: boolean;
}

export interface PointFields {
  name?: string;
  parameter?: Parameter;
  unit?: string;
  location?: string | null;
  minLimit?: number | null;
  maxLimit?: number | null;
  warnMargin?: number;
  frequency?: MonitoringFrequency;
  conditionId?: string | null;
  active?: boolean;
}

const num = (v: string | null) => (v === null ? null : Number(v));
const toReading = (r: ReadingRow): Reading => ({ ...r, value: Number(r.value) });
const RECENT = 14;

export function createMonitoringService(deps: EnvironmentDeps, conditionService: ConditionService) {
  const now = deps.now ?? (() => new Date());

  const livePoint = (projectId: string, id: string) =>
    and(
      eq(monitoringPoints.id, id),
      eq(monitoringPoints.projectId, projectId),
      isNull(monitoringPoints.deletedAt),
    );

  async function pointRow(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx
      .select()
      .from(monitoringPoints)
      .where(livePoint(projectId, id))
      .limit(1);
    if (!r) throw new AppError('environment.point_not_found');
    return r;
  }

  function checkLimits(min: number | null, max: number | null) {
    if (min === null && max === null)
      throw new AppError('validation_failed', 'Set a minimum, a maximum, or both.', [
        { path: 'maxLimit', message: 'Set at least one limit' },
      ]);
    if (min !== null && max !== null && min >= max)
      throw new AppError('validation_failed', 'The minimum must be below the maximum.', [
        { path: 'minLimit', message: 'Must be below the maximum' },
      ]);
  }

  async function checkCondition(scope: TenantScope, projectId: string, id: string) {
    const [c] = await scope.tx
      .select({ id: conditions.id })
      .from(conditions)
      .where(
        and(
          eq(conditions.id, id),
          eq(conditions.projectId, projectId),
          isNull(conditions.deletedAt),
        ),
      )
      .limit(1);
    if (!c)
      throw new AppError(
        'environment.condition_not_found',
        'That condition is not on this project.',
        [{ path: 'conditionId', message: 'Not a condition on the project' }],
      );
  }

  async function listPoints(scope: TenantScope, projectId: string): Promise<PointView[]> {
    const project = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    const points = await scope.tx
      .select()
      .from(monitoringPoints)
      .where(and(eq(monitoringPoints.projectId, projectId), isNull(monitoringPoints.deletedAt)))
      .orderBy(asc(monitoringPoints.name));
    if (points.length === 0) return [];
    // A month of readings is enough for the sparkline, latest value and trend; older ones are read per point.
    const since = new Date(now().getTime() - 35 * 24 * 3600_000);
    const rows = await scope.tx
      .select()
      .from(readings)
      .where(and(eq(readings.projectId, projectId), gte(readings.takenAt, since)))
      .orderBy(asc(readings.takenAt), asc(readings.id));
    const byPoint = new Map<string, Reading[]>();
    for (const r of rows) {
      const list = byPoint.get(r.pointId) ?? [];
      list.push(toReading(r));
      byPoint.set(r.pointId, list);
    }
    const open = await scope.tx
      .select({ pointId: readings.pointId, n: sql<number>`count(*)::int` })
      .from(readings)
      .where(
        and(
          eq(readings.projectId, projectId),
          eq(readings.status, 'breach'),
          isNull(readings.respondedAt),
        ),
      )
      .groupBy(readings.pointId);
    const openBy = new Map(open.map((o) => [o.pointId, o.n]));
    return points.map((p) => {
      const list = byPoint.get(p.id) ?? [];
      const latest = list.at(-1) ?? null;
      const limits = {
        min: num(p.minLimit),
        max: num(p.maxLimit),
        warnMargin: Number(p.warnMargin),
      };
      return {
        point: p,
        minLimit: limits.min,
        maxLimit: limits.max,
        warnMargin: limits.warnMargin,
        latest,
        recent: list.slice(-RECENT).map((r) => r.value),
        openBreaches: openBy.get(p.id) ?? 0,
        isOverdue:
          p.active &&
          isPointOverdue(
            p.frequency,
            latest ? localDateOf(latest.takenAt, project.timezone) : null,
            localDateOf(p.createdAt, project.timezone),
            today,
          ),
        isTrending:
          p.active &&
          isTrendingToBreach(
            list.map((r) => r.value),
            limits,
          ),
      };
    });
  }

  async function createPoint(
    scope: TenantScope,
    projectId: string,
    input: PointFields & { name: string; parameter: Parameter; unit: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    const min = input.minLimit ?? null;
    const max = input.maxLimit ?? null;
    checkLimits(min, max);
    if (input.conditionId) await checkCondition(scope, projectId, input.conditionId);
    const id = uuidv7();
    await scope.tx.insert(monitoringPoints).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      name: input.name.trim(),
      parameter: input.parameter,
      unit: input.unit.trim(),
      location: input.location ?? null,
      minLimit: min === null ? null : String(min),
      maxLimit: max === null ? null : String(max),
      warnMargin: String(input.warnMargin ?? 0.2),
      frequency: input.frequency ?? 'daily',
      conditionId: input.conditionId ?? null,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return (await listPoints(scope, projectId)).find((v) => v.point.id === id)!;
  }

  async function updatePoint(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: PointFields,
  ) {
    const current = await pointRow(scope, projectId, id);
    if (current.version !== expectedVersion) throw versionConflict();
    const min = patch.minLimit !== undefined ? patch.minLimit : num(current.minLimit);
    const max = patch.maxLimit !== undefined ? patch.maxLimit : num(current.maxLimit);
    checkLimits(min, max);
    if (patch.conditionId) await checkCondition(scope, projectId, patch.conditionId);
    const [r] = await scope.tx
      .update(monitoringPoints)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.parameter !== undefined ? { parameter: patch.parameter } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit.trim() } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        minLimit: min === null ? null : String(min),
        maxLimit: max === null ? null : String(max),
        ...(patch.warnMargin !== undefined ? { warnMargin: String(patch.warnMargin) } : {}),
        ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
        ...(patch.conditionId !== undefined ? { conditionId: patch.conditionId } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(monitoringPoints.id, id), eq(monitoringPoints.version, expectedVersion)))
      .returning({ id: monitoringPoints.id });
    if (!r) throw versionConflict();
    return (await listPoints(scope, projectId)).find((v) => v.point.id === id)!;
  }

  /** Logs a reading. The status is fixed here against the limits; a breach flags the linked condition. */
  async function logReading(
    scope: TenantScope,
    projectId: string,
    pointId: string,
    input: { value: number; takenAt?: Date; note?: string; fileIds?: string[] },
  ) {
    const point = await pointRow(scope, projectId, pointId);
    if (!point.active)
      throw new AppError('validation_failed', 'This monitoring point is switched off.', [
        { path: 'pointId', message: 'Switched off' },
      ]);
    if (!Number.isFinite(input.value))
      throw new AppError('validation_failed', 'Enter a number.', [
        { path: 'value', message: 'Not a number' },
      ]);
    const takenAt = input.takenAt ?? now();
    if (takenAt.getTime() > now().getTime() + 5 * 60_000)
      throw new AppError('validation_failed', 'A reading cannot be in the future.', [
        { path: 'takenAt', message: 'In the future' },
      ]);
    await checkFiles(deps, scope, projectId, input.fileIds ?? []);
    const status = judgeReading(input.value, {
      min: num(point.minLimit),
      max: num(point.maxLimit),
      warnMargin: Number(point.warnMargin),
    });
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(readings)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        pointId,
        value: String(input.value),
        takenAt,
        status,
        note: input.note?.trim() || null,
        fileIds: [...new Set(input.fileIds ?? [])],
        createdBy: scope.ctx.userId,
      })
      .returning();
    if (status === 'breach') {
      if (point.conditionId)
        await conditionService.flagFromBreach(
          scope,
          projectId,
          point.conditionId,
          `Monitoring breach at ${point.name}: ${input.value} ${point.unit}.`,
          [...new Set(input.fileIds ?? [])],
        );
      scope.events.add({
        type: 'environment.reading.breach.v1',
        projectId,
        entityType: 'environment_reading',
        entityId: id,
        entityVersion: 1,
        data: {
          readingId: id,
          pointId,
          parameter: point.parameter,
          value: input.value,
          unit: point.unit,
        },
      });
    }
    return { reading: toReading(row!), point };
  }

  async function listPointReadings(
    scope: TenantScope,
    projectId: string,
    pointId: string,
    opts: { status?: ReadingStatus; limit: number; cursor?: string },
  ) {
    const point = await pointRow(scope, projectId, pointId);
    const after = decodeCursor<{ at: string; id: string }>(opts.cursor);
    const where: SQL[] = [eq(readings.pointId, pointId)];
    if (opts.status) where.push(eq(readings.status, opts.status));
    if (after)
      where.push(
        sql`(${readings.takenAt}, ${readings.id}) < (${new Date(after.at)}::timestamptz, ${after.id}::uuid)`,
      );
    const rows = await scope.tx
      .select()
      .from(readings)
      .where(and(...where))
      .orderBy(desc(readings.takenAt), desc(readings.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ at: r.takenAt.toISOString(), id: r.id }));
    return { point, data: page.data.map(toReading), nextCursor: page.nextCursor };
  }

  /** Recent readings across the project, for the breach register. */
  async function listReadings(
    scope: TenantScope,
    projectId: string,
    opts: { status?: ReadingStatus; open?: boolean; limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ at: string; id: string }>(opts.cursor);
    const where: SQL[] = [eq(readings.projectId, projectId)];
    if (opts.status) where.push(eq(readings.status, opts.status));
    if (opts.open) where.push(isNull(readings.respondedAt), eq(readings.status, 'breach'));
    if (after)
      where.push(
        sql`(${readings.takenAt}, ${readings.id}) < (${new Date(after.at)}::timestamptz, ${after.id}::uuid)`,
      );
    const rows = await scope.tx
      .select({ r: readings, name: monitoringPoints.name, unit: monitoringPoints.unit })
      .from(readings)
      .innerJoin(monitoringPoints, eq(monitoringPoints.id, readings.pointId))
      .where(and(...where))
      .orderBy(desc(readings.takenAt), desc(readings.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (x) => ({ at: x.r.takenAt.toISOString(), id: x.r.id }));
    return {
      data: page.data.map((x) => ({ ...toReading(x.r), pointName: x.name, unit: x.unit })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Answers a breach: a corrective-action note, and optionally an environmental incident in the incident register
   * (compliance 03: not duplicated here). A breach is answered once.
   */
  async function respond(
    scope: TenantScope,
    projectId: string,
    readingId: string,
    input: { note: string; raiseIncident: boolean },
  ) {
    const [row] = await scope.tx
      .select()
      .from(readings)
      .where(and(eq(readings.id, readingId), eq(readings.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('environment.reading_not_found');
    if (row.status !== 'breach')
      throw new AppError(
        'environment.invalid_transition',
        'Only a breach needs a response.',
        undefined,
        {
          status: row.status,
        },
      );
    if (row.respondedAt)
      throw new AppError(
        'environment.invalid_transition',
        'This breach has already been answered.',
      );
    const point = await pointRow(scope, projectId, row.pointId);
    let incident: { id: string; number: number } | null = null;
    if (input.raiseIncident) {
      const where = point.location ? `${point.name} (${point.location})` : point.name;
      incident = await deps.safety.reportEnvironmental(scope, projectId, {
        title: `Monitoring breach: ${point.name}`,
        description: `${Number(row.value)} ${point.unit} recorded at ${where}, outside the limit${
          point.maxLimit !== null ? ` of ${Number(point.maxLimit)}` : ''
        }${point.minLimit !== null ? ` (minimum ${Number(point.minLimit)})` : ''}. Corrective action: ${input.note.trim()}`,
        location: point.location,
        occurredAt: row.takenAt,
      });
    }
    const [r] = await scope.tx
      .update(readings)
      .set({
        responseNote: input.note.trim(),
        respondedAt: now(),
        respondedBy: scope.ctx.userId,
        incidentId: incident?.id ?? null,
      })
      .where(and(eq(readings.id, readingId), isNull(readings.respondedAt)))
      .returning();
    if (!r) throw versionConflict();
    return { reading: toReading(r), point, incident };
  }

  /** Counts and the flags' raw inputs for the summary. */
  async function summaryInputs(scope: TenantScope, projectId: string) {
    const views = (await listPoints(scope, projectId)).filter((v) => v.point.active);
    return {
      points: views.length,
      openBreaches: views.reduce((n, v) => n + v.openBreaches, 0),
      overdue: views
        .filter((v) => v.isOverdue)
        .map((v) => ({ id: v.point.id, name: v.point.name })),
      trending: views
        .filter((v) => v.isTrending)
        .map((v) => ({ id: v.point.id, name: v.point.name })),
      breaching: views
        .filter((v) => v.openBreaches > 0)
        .map((v) => ({ id: v.point.id, name: v.point.name })),
    };
  }

  return {
    listPoints,
    createPoint,
    updatePoint,
    logReading,
    listPointReadings,
    listReadings,
    respond,
    summaryInputs,
  };
}

export type MonitoringService = ReturnType<typeof createMonitoringService>;
