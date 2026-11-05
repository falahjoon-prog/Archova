import { and, asc, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import { isLocalDate } from '@archova/time';
import { nextPlacement } from '../domain/equipment';
import { equipment, equipmentLogs, type EquipmentStatus } from '../infra/tables';

export type EquipmentRow = typeof equipment.$inferSelect;
export type EquipmentLogRow = typeof equipmentLogs.$inferSelect;
export type EquipmentView = EquipmentRow & { totalHours: string };

export interface EquipmentDeps {
  platform: Pick<PlatformApi, 'getProject'>;
}

export interface CreateEquipmentInput {
  name: string;
  assetNumber: string;
  type: string;
  notes?: string;
}

export interface UpdateEquipmentInput {
  name?: string;
  assetNumber?: string;
  type?: string;
  notes?: string | null;
  status?: EquipmentStatus;
  currentProjectId?: string | null;
}

export interface LogUsageInput {
  projectId: string;
  loggedOn: string;
  /** Hours on site; negative to correct an earlier entry. */
  hours: string;
  operator?: string;
  notes?: string;
}

const hoursNumber = (v: string) => Math.round(Number(v) * 100);
const fromHundredths = (n: number) => (n / 100).toFixed(2);

/**
 * Equipment register: the organisation's plant and tools, where each item is, and the hours it has worked
 * (plan: workforce and equipment). Permission is checked by the route (`x-permission`).
 */
export function createEquipmentService(deps: EquipmentDeps) {
  async function load(scope: TenantScope, id: string, lock = false) {
    const q = scope.tx.select().from(equipment).where(eq(equipment.id, id)).limit(1);
    const [row] = await (lock ? q.for('update') : q);
    if (!row) throw new AppError('workforce_equipment.not_found');
    return row;
  }

  async function totals(scope: TenantScope, onlyId?: string) {
    const rows = await scope.tx
      .select({
        equipmentId: equipmentLogs.equipmentId,
        total: sql<string>`coalesce(sum(${equipmentLogs.hours}), 0)`,
      })
      .from(equipmentLogs)
      .where(onlyId ? eq(equipmentLogs.equipmentId, onlyId) : undefined)
      .groupBy(equipmentLogs.equipmentId);
    const map = new Map(rows.map((r) => [r.equipmentId, r.total]));
    return (id: string) => fromHundredths(hoursNumber(map.get(id) ?? '0'));
  }

  const assertAssetFree = async (scope: TenantScope, assetNumber: string, exceptId?: string) => {
    const [clash] = await scope.tx
      .select({ id: equipment.id })
      .from(equipment)
      .where(
        and(
          sql`lower(${equipment.assetNumber}) = lower(${assetNumber})`,
          exceptId ? ne(equipment.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (clash) throw new AppError('workforce_equipment.asset_number_taken');
  };

  async function list(
    scope: TenantScope,
    q: { status?: EquipmentStatus; projectId?: string; includeRetired: boolean },
  ): Promise<EquipmentView[]> {
    const rows = await scope.tx
      .select()
      .from(equipment)
      .where(
        and(
          q.status ? eq(equipment.status, q.status) : undefined,
          q.projectId ? eq(equipment.currentProjectId, q.projectId) : undefined,
          q.includeRetired || q.status === 'retired' ? undefined : ne(equipment.status, 'retired'),
        ),
      )
      .orderBy(asc(equipment.assetNumber))
      .limit(2000);
    const hours = await totals(scope);
    return rows.map((r) => ({ ...r, totalHours: hours(r.id) }));
  }

  async function get(scope: TenantScope, id: string): Promise<EquipmentView> {
    const row = await load(scope, id);
    return { ...row, totalHours: (await totals(scope, id))(row.id) };
  }

  async function create(scope: TenantScope, input: CreateEquipmentInput): Promise<EquipmentView> {
    const assetNumber = input.assetNumber.trim();
    await assertAssetFree(scope, assetNumber);
    const [row] = await scope.tx
      .insert(equipment)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        name: input.name.trim(),
        assetNumber,
        type: input.type.trim(),
        notes: input.notes?.trim() || null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return { ...row!, totalHours: '0.00' };
  }

  async function update(
    scope: TenantScope,
    id: string,
    expected: number,
    input: UpdateEquipmentInput,
  ): Promise<EquipmentView> {
    const cur = await load(scope, id, true);
    if (cur.version !== expected) throw versionConflict();
    const placement = nextPlacement(cur, {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.currentProjectId !== undefined ? { currentProjectId: input.currentProjectId } : {}),
    });
    if (!placement.ok)
      throw new AppError('validation_failed', placement.message, [
        { path: placement.path, message: placement.message },
      ]);
    if (placement.next.currentProjectId && placement.next.currentProjectId !== cur.currentProjectId)
      await deps.platform.getProject(scope, placement.next.currentProjectId);
    const assetNumber = input.assetNumber?.trim();
    if (assetNumber && assetNumber.toLowerCase() !== cur.assetNumber.toLowerCase())
      await assertAssetFree(scope, assetNumber, id);
    const [row] = await scope.tx
      .update(equipment)
      .set({
        name: input.name?.trim() ?? cur.name,
        assetNumber: assetNumber ?? cur.assetNumber,
        type: input.type?.trim() ?? cur.type,
        notes: input.notes === undefined ? cur.notes : input.notes?.trim() || null,
        status: placement.next.status,
        currentProjectId: placement.next.currentProjectId,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
        version: cur.version + 1,
      })
      .where(and(eq(equipment.id, id), eq(equipment.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return { ...row, totalHours: (await totals(scope, id))(id) };
  }

  async function logUsage(
    scope: TenantScope,
    equipmentId: string,
    input: LogUsageInput,
  ): Promise<EquipmentLogRow> {
    // Serialise per item so two corrections cannot together take the total below zero.
    const item = await load(scope, equipmentId, true);
    if (item.status === 'retired') throw new AppError('workforce_equipment.retired');
    if (!isLocalDate(input.loggedOn))
      throw new AppError('validation_failed', 'Invalid date', [
        { path: 'loggedOn', message: 'Use a calendar date (YYYY-MM-DD)' },
      ]);
    const entry = hoursNumber(input.hours);
    if (!Number.isFinite(entry) || entry === 0 || Math.abs(entry) > 2400)
      throw new AppError('validation_failed', 'Hours must be between -24 and 24, not zero.', [
        { path: 'hours', message: 'Hours must be between -24 and 24, not zero' },
      ]);
    await deps.platform.getProject(scope, input.projectId);
    if (entry < 0) {
      const logged = hoursNumber((await totals(scope, equipmentId))(equipmentId));
      if (logged + entry < 0) throw new AppError('workforce_equipment.hours_below_zero');
    }
    const [row] = await scope.tx
      .insert(equipmentLogs)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        equipmentId,
        projectId: input.projectId,
        loggedOn: input.loggedOn,
        hours: fromHundredths(entry),
        operator: input.operator?.trim() || null,
        notes: input.notes?.trim() || null,
        recordedBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function listLogs(
    scope: TenantScope,
    equipmentId: string,
    q: { from?: string; to?: string },
  ): Promise<EquipmentLogRow[]> {
    await load(scope, equipmentId);
    return scope.tx
      .select()
      .from(equipmentLogs)
      .where(
        and(
          eq(equipmentLogs.equipmentId, equipmentId),
          q.from ? gte(equipmentLogs.loggedOn, q.from) : undefined,
          q.to ? lte(equipmentLogs.loggedOn, q.to) : undefined,
        ),
      )
      .orderBy(desc(equipmentLogs.loggedOn), desc(equipmentLogs.recordedAt))
      .limit(1000);
  }

  return { list, get, create, update, logUsage, listLogs };
}

export type EquipmentService = ReturnType<typeof createEquipmentService>;
