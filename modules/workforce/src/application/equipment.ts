import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { bookable, datesOverlap, normaliseHours } from '../domain/equipment';
import { equipment, equipmentBookings, equipmentLogs, type EquipmentStatus } from '../infra/tables';

export type EquipmentRow = typeof equipment.$inferSelect;
export type BookingRow = typeof equipmentBookings.$inferSelect;
export type LogRow = typeof equipmentLogs.$inferSelect;

export interface EquipmentDeps {
  access: AccessService;
}

/** The project's equipment register, who has each machine booked and when, and the hours it has run. */
export function createEquipmentService(deps: EquipmentDeps) {
  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  async function row(scope: TenantScope, projectId: string, id: string, lock = false) {
    const q = scope.tx
      .select()
      .from(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.projectId, projectId)))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('workforce_equipment.not_found');
    return r;
  }

  async function list(scope: TenantScope, projectId: string) {
    await need(scope, 'workforce.equipment.view', projectId);
    return scope.tx
      .select()
      .from(equipment)
      .where(eq(equipment.projectId, projectId))
      .orderBy(asc(equipment.name), asc(equipment.id))
      .limit(500);
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: { name: string; assetNumber: string; type: string },
  ) {
    await need(scope, 'workforce.equipment.manage', projectId);
    const assetNumber = input.assetNumber.trim();
    const [dup] = await scope.tx
      .select({ id: equipment.id })
      .from(equipment)
      .where(and(eq(equipment.projectId, projectId), eq(equipment.assetNumber, assetNumber)))
      .limit(1);
    if (dup)
      throw new AppError(
        'workforce_equipment.asset_taken',
        `Asset number ${assetNumber} is already on this project.`,
      );
    const [r] = await scope.tx
      .insert(equipment)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: input.name.trim(),
        assetNumber,
        type: input.type.trim(),
        createdBy: scope.ctx.userId,
      })
      .returning();
    return r!;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    patch: { name?: string; type?: string; status?: EquipmentStatus },
  ) {
    await need(scope, 'workforce.equipment.manage', projectId);
    const cur = await row(scope, projectId, id, true);
    const [r] = await scope.tx
      .update(equipment)
      .set({
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.type ? { type: patch.type.trim() } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        version: cur.version + 1,
      })
      .where(eq(equipment.id, cur.id))
      .returning();
    return r!;
  }

  async function bookings(
    scope: TenantScope,
    projectId: string,
    opts: { from?: string; to?: string; equipmentId?: string },
  ) {
    await need(scope, 'workforce.equipment.view', projectId);
    return scope.tx
      .select()
      .from(equipmentBookings)
      .where(
        and(
          eq(equipmentBookings.projectId, projectId),
          opts.from ? gte(equipmentBookings.endsOn, opts.from) : undefined,
          opts.to ? lte(equipmentBookings.startsOn, opts.to) : undefined,
          opts.equipmentId ? eq(equipmentBookings.equipmentId, opts.equipmentId) : undefined,
        ),
      )
      .orderBy(asc(equipmentBookings.startsOn), asc(equipmentBookings.id))
      .limit(500);
  }

  async function book(
    scope: TenantScope,
    projectId: string,
    equipmentId: string,
    input: { startsOn: string; endsOn: string; bookedFor: string; note?: string },
  ) {
    await need(scope, 'workforce.equipment.manage', projectId);
    // Lock the machine so two people booking it at once are serialised and the clash check holds.
    const e = await row(scope, projectId, equipmentId, true);
    if (!bookable(e.status))
      throw new AppError(
        'workforce_equipment.bad_state',
        `${e.name} is ${e.status} and can't be booked.`,
      );
    if (input.endsOn < input.startsOn)
      throw new AppError('validation_failed', 'A booking must not end before it starts.', [
        { path: 'endsOn', message: 'Must be on or after the start' },
      ]);
    const existing = await scope.tx
      .select()
      .from(equipmentBookings)
      .where(and(eq(equipmentBookings.equipmentId, e.id), eq(equipmentBookings.status, 'active')));
    const clash = existing.find((b) => datesOverlap(b, input));
    if (clash)
      throw new AppError(
        'workforce_equipment.booking_conflict',
        `${e.name} is already booked for ${clash.bookedFor} from ${clash.startsOn} to ${clash.endsOn}.`,
      );
    const [b] = await scope.tx
      .insert(equipmentBookings)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        equipmentId: e.id,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        bookedFor: input.bookedFor.trim(),
        note: input.note?.trim() || null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return b!;
  }

  async function cancelBooking(
    scope: TenantScope,
    projectId: string,
    equipmentId: string,
    bookingId: string,
  ) {
    await need(scope, 'workforce.equipment.manage', projectId);
    const e = await row(scope, projectId, equipmentId, true);
    const [b] = await scope.tx
      .select()
      .from(equipmentBookings)
      .where(and(eq(equipmentBookings.id, bookingId), eq(equipmentBookings.equipmentId, e.id)))
      .limit(1);
    if (!b) throw new AppError('workforce_equipment.booking_not_found');
    if (b.status === 'cancelled')
      throw new AppError('workforce_equipment.bad_state', 'This booking is already cancelled.');
    const [r] = await scope.tx
      .update(equipmentBookings)
      .set({ status: 'cancelled' })
      .where(eq(equipmentBookings.id, b.id))
      .returning();
    return r!;
  }

  async function logs(scope: TenantScope, projectId: string, equipmentId: string) {
    await need(scope, 'workforce.equipment.view', projectId);
    const e = await row(scope, projectId, equipmentId);
    return scope.tx
      .select()
      .from(equipmentLogs)
      .where(eq(equipmentLogs.equipmentId, e.id))
      .orderBy(desc(equipmentLogs.logDate), desc(equipmentLogs.id))
      .limit(500);
  }

  async function logHours(
    scope: TenantScope,
    projectId: string,
    equipmentId: string,
    input: { date: string; hours: string; operator?: string; notes?: string },
  ) {
    await need(scope, 'workforce.equipment.log', projectId);
    const e = await row(scope, projectId, equipmentId);
    if (e.status === 'retired')
      throw new AppError('workforce_equipment.bad_state', `${e.name} is retired.`);
    const hours = normaliseHours(input.hours);
    if (!hours)
      throw new AppError('validation_failed', 'Hours must be in quarter hours, up to 24.', [
        { path: 'hours', message: 'Use quarter hours, e.g. 7.5' },
      ]);
    const [l] = await scope.tx
      .insert(equipmentLogs)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        equipmentId: e.id,
        logDate: input.date,
        hours,
        operator: input.operator?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return l!;
  }

  return { list, create, update, bookings, book, cancelBooking, logs, logHours };
}

export type EquipmentService = ReturnType<typeof createEquipmentService>;
