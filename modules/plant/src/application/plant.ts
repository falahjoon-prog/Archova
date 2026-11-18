import { and, asc, desc, eq, gte, lte, ne } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { localDateOf } from '@archova/time';
import {
  allocatable,
  bookedDays,
  computeFlags,
  nextDueAfter,
  spanDays,
  spansOverlap,
  utilisationPct,
  dueState,
  type AssetCategory,
  type AssetStatus,
  type DueState,
  type Ownership,
  type PlanKind,
  type Span,
} from '../domain/plant';
import { allocations, assets, maintenancePlans, maintenanceRecords } from '../infra/tables';

export type AssetRow = typeof assets.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;
export type PlanRow = typeof maintenancePlans.$inferSelect;
export type RecordRow = typeof maintenanceRecords.$inferSelect;

/** Plant is planned in Australian time; the org has no zone of its own yet. */
const TIME_ZONE = 'Australia/Sydney';
const MAX_ROWS = 1000;

export interface PlantDeps {
  access: AccessService;
  now?: () => Date;
}

export interface AssetInput {
  name: string;
  assetNumber: string;
  category: AssetCategory;
  ownership: Ownership;
  supplier?: string | undefined;
  make?: string | undefined;
  model?: string | undefined;
  serialNumber?: string | undefined;
  dailyRateCents?: number | undefined;
  notes?: string | undefined;
}

const clean = (s: string | undefined) => s?.trim() || null;

/** The org's fleet: register, project allocations, maintenance schedule, utilisation and Nova's flags. */
export function createPlantService(deps: PlantDeps) {
  const now = deps.now ?? (() => new Date());
  const today = () => localDateOf(now(), TIME_ZONE);
  const need = (scope: TenantScope, key: string) => deps.access.assert(scope, key);

  /** Daily rates are cost data: only those who manage the register see them. */
  async function canSeeRates(scope: TenantScope) {
    return deps.access.can(scope, 'plant.assets.manage');
  }
  const redact = (a: AssetRow, rates: boolean): AssetRow =>
    rates ? a : { ...a, dailyRateCents: null };

  async function assetRow(scope: TenantScope, id: string, lock = false) {
    const q = scope.tx.select().from(assets).where(eq(assets.id, id)).limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('plant.asset_not_found');
    return r;
  }

  async function listAssets(scope: TenantScope) {
    await need(scope, 'plant.assets.view');
    const rates = await canSeeRates(scope);
    const rows = await scope.tx
      .select()
      .from(assets)
      .orderBy(asc(assets.name), asc(assets.id))
      .limit(MAX_ROWS);
    return rows.map((a) => redact(a, rates));
  }

  async function createAsset(scope: TenantScope, input: AssetInput) {
    await need(scope, 'plant.assets.manage');
    const assetNumber = input.assetNumber.trim();
    const [dup] = await scope.tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.assetNumber, assetNumber))
      .limit(1);
    if (dup)
      throw new AppError(
        'plant.asset_number_taken',
        `Asset number ${assetNumber} is already used.`,
      );
    const [r] = await scope.tx
      .insert(assets)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        name: input.name.trim(),
        assetNumber,
        category: input.category,
        ownership: input.ownership,
        supplier: clean(input.supplier),
        make: clean(input.make),
        model: clean(input.model),
        serialNumber: clean(input.serialNumber),
        dailyRateCents: input.dailyRateCents ?? null,
        notes: clean(input.notes),
        createdBy: scope.ctx.userId,
      })
      .returning();
    return r!;
  }

  async function updateAsset(
    scope: TenantScope,
    id: string,
    patch: Partial<AssetInput> & { status?: AssetStatus },
  ) {
    await need(scope, 'plant.assets.manage');
    const cur = await assetRow(scope, id, true);
    if (patch.status === 'retired') {
      const [future] = await scope.tx
        .select({ id: allocations.id })
        .from(allocations)
        .where(
          and(
            eq(allocations.assetId, cur.id),
            eq(allocations.status, 'active'),
            gte(allocations.endsOn, today()),
          ),
        )
        .limit(1);
      if (future)
        throw new AppError(
          'plant.bad_state',
          `${cur.name} still has allocations to come. Cancel them before retiring it.`,
        );
    }
    const [r] = await scope.tx
      .update(assets)
      .set({
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.category ? { category: patch.category } : {}),
        ...(patch.ownership ? { ownership: patch.ownership } : {}),
        ...(patch.supplier !== undefined ? { supplier: clean(patch.supplier) } : {}),
        ...(patch.make !== undefined ? { make: clean(patch.make) } : {}),
        ...(patch.model !== undefined ? { model: clean(patch.model) } : {}),
        ...(patch.serialNumber !== undefined ? { serialNumber: clean(patch.serialNumber) } : {}),
        ...(patch.dailyRateCents !== undefined ? { dailyRateCents: patch.dailyRateCents } : {}),
        ...(patch.notes !== undefined ? { notes: clean(patch.notes) } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        version: cur.version + 1,
      })
      .where(eq(assets.id, cur.id))
      .returning();
    return r!;
  }

  /** What an allocation is expected to cost: its days at the machine's daily rate. Null without a rate you may see. */
  async function costOf(scope: TenantScope, rows: readonly AllocationRow[]) {
    const rates = await canSeeRates(scope);
    const all = await scope.tx
      .select({ id: assets.id, rate: assets.dailyRateCents })
      .from(assets)
      .limit(MAX_ROWS);
    const rate = new Map(all.map((a) => [a.id, a.rate]));
    return rows.map((a) => {
      const r = rates ? rate.get(a.assetId) : null;
      return { row: a, estimatedCostCents: r === null || r === undefined ? null : r * spanDays(a) };
    });
  }

  async function listAllocations(
    scope: TenantScope,
    opts: { from?: string; to?: string; assetId?: string; projectId?: string },
  ) {
    await need(scope, 'plant.assets.view');
    const rows = await scope.tx
      .select()
      .from(allocations)
      .where(
        and(
          opts.from ? gte(allocations.endsOn, opts.from) : undefined,
          opts.to ? lte(allocations.startsOn, opts.to) : undefined,
          opts.assetId ? eq(allocations.assetId, opts.assetId) : undefined,
          opts.projectId ? eq(allocations.projectId, opts.projectId) : undefined,
        ),
      )
      .orderBy(asc(allocations.startsOn), asc(allocations.id))
      .limit(MAX_ROWS);
    return costOf(scope, rows);
  }

  async function allocate(
    scope: TenantScope,
    assetId: string,
    input: {
      projectId: string;
      startsOn: string;
      endsOn: string;
      costCodeId?: string | undefined;
      note?: string | undefined;
    },
  ) {
    await need(scope, 'plant.allocations.manage');
    // Lock the machine so two people allocating it at once are serialised and the clash check holds.
    const a = await assetRow(scope, assetId, true);
    if (!allocatable(a.status))
      throw new AppError(
        'plant.bad_state',
        `${a.name} is ${a.status === 'maintenance' ? 'in the workshop' : 'retired'} and can't be allocated.`,
      );
    if (input.endsOn < input.startsOn)
      throw new AppError('validation_failed', 'An allocation must not end before it starts.', [
        { path: 'endsOn', message: 'Must be on or after the start' },
      ]);
    const existing = await scope.tx
      .select()
      .from(allocations)
      .where(and(eq(allocations.assetId, a.id), eq(allocations.status, 'active')));
    const clash = existing.find((x) => spansOverlap(x, input));
    if (clash)
      throw new AppError(
        'plant.allocation_conflict',
        `${a.name} is already allocated from ${clash.startsOn} to ${clash.endsOn}.`,
      );
    const [r] = await scope.tx
      .insert(allocations)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        assetId: a.id,
        projectId: input.projectId,
        costCodeId: input.costCodeId ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        note: clean(input.note),
        createdBy: scope.ctx.userId,
      })
      .returning();
    return (await costOf(scope, [r!]))[0]!;
  }

  async function cancelAllocation(scope: TenantScope, id: string) {
    await need(scope, 'plant.allocations.manage');
    const [cur] = await scope.tx.select().from(allocations).where(eq(allocations.id, id)).limit(1);
    if (!cur) throw new AppError('plant.allocation_not_found');
    if (cur.status === 'cancelled')
      throw new AppError('plant.bad_state', 'This allocation is already cancelled.');
    const [r] = await scope.tx
      .update(allocations)
      .set({ status: 'cancelled' })
      .where(eq(allocations.id, cur.id))
      .returning();
    return (await costOf(scope, [r!]))[0]!;
  }

  const withState = (p: PlanRow, t: string): { row: PlanRow; state: DueState | null } => ({
    row: p,
    state: p.nextDueOn && p.active ? dueState(p.nextDueOn, t, p.kind) : null,
  });

  async function listPlans(scope: TenantScope, opts: { assetId?: string }) {
    await need(scope, 'plant.assets.view');
    const t = today();
    const rows = await scope.tx
      .select()
      .from(maintenancePlans)
      .where(opts.assetId ? eq(maintenancePlans.assetId, opts.assetId) : undefined)
      .orderBy(asc(maintenancePlans.nextDueOn), asc(maintenancePlans.id))
      .limit(MAX_ROWS);
    return rows.map((p) => withState(p, t));
  }

  async function createPlan(
    scope: TenantScope,
    assetId: string,
    input: {
      title: string;
      kind: PlanKind;
      intervalDays?: number | undefined;
      nextDueOn: string;
      lastDoneOn?: string | undefined;
      responsible?: string | undefined;
    },
  ) {
    await need(scope, 'plant.assets.manage');
    const a = await assetRow(scope, assetId);
    const [r] = await scope.tx
      .insert(maintenancePlans)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        assetId: a.id,
        title: input.title.trim(),
        kind: input.kind,
        intervalDays: input.intervalDays ?? null,
        nextDueOn: input.nextDueOn,
        lastDoneOn: input.lastDoneOn ?? null,
        responsible: clean(input.responsible),
        createdBy: scope.ctx.userId,
      })
      .returning();
    return withState(r!, today());
  }

  /**
   * Record that a plan was done. A recurring plan moves its next due date to `doneOn` plus the interval; a one-off
   * plan is finished and drops off the schedule.
   */
  async function completePlan(
    scope: TenantScope,
    planId: string,
    input: {
      doneOn: string;
      performedBy?: string | undefined;
      note?: string | undefined;
      costCents?: number | undefined;
    },
  ) {
    await need(scope, 'plant.assets.manage');
    const [cur] = await scope.tx
      .select()
      .from(maintenancePlans)
      .where(eq(maintenancePlans.id, planId))
      .limit(1)
      .for('update');
    if (!cur) throw new AppError('plant.plan_not_found');
    if (!cur.active) throw new AppError('plant.bad_state', 'This plan is finished.');
    if (input.doneOn > today())
      throw new AppError('validation_failed', "A job can't be recorded as done in the future.", [
        { path: 'doneOn', message: 'Must be today or earlier' },
      ]);
    const next = nextDueAfter(input.doneOn, cur.intervalDays);
    await scope.tx.insert(maintenanceRecords).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      planId: cur.id,
      assetId: cur.assetId,
      doneOn: input.doneOn,
      performedBy: clean(input.performedBy),
      note: clean(input.note),
      costCents: input.costCents ?? null,
      createdBy: scope.ctx.userId,
    });
    const [r] = await scope.tx
      .update(maintenancePlans)
      .set({
        lastDoneOn: input.doneOn,
        nextDueOn: next,
        active: next !== null,
        version: cur.version + 1,
      })
      .where(eq(maintenancePlans.id, cur.id))
      .returning();
    return withState(r!, today());
  }

  async function records(scope: TenantScope, assetId: string) {
    await need(scope, 'plant.assets.view');
    const a = await assetRow(scope, assetId);
    return scope.tx
      .select()
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.assetId, a.id))
      .orderBy(desc(maintenanceRecords.doneOn), desc(maintenanceRecords.id))
      .limit(MAX_ROWS);
  }

  /** Fleet, per-machine and per-project utilisation of `[from, to]`, with the hire or carrying cost where visible. */
  async function utilisation(scope: TenantScope, window: Span) {
    await need(scope, 'plant.assets.view');
    if (window.endsOn < window.startsOn || spanDays(window) > 366)
      throw new AppError('validation_failed', 'Choose a range of up to a year.', [
        { path: 'to', message: 'Must be on or after the start, within 366 days' },
      ]);
    const rates = await canSeeRates(scope);
    const fleet = (
      await scope.tx.select().from(assets).where(ne(assets.status, 'retired')).limit(MAX_ROWS)
    ).sort((x, y) => x.name.localeCompare(y.name));
    const rows = await scope.tx
      .select()
      .from(allocations)
      .where(
        and(
          eq(allocations.status, 'active'),
          gte(allocations.endsOn, window.startsOn),
          lte(allocations.startsOn, window.endsOn),
        ),
      )
      .limit(MAX_ROWS * 5);
    const days = spanDays(window);
    const clip = (a: Span): Span => ({
      startsOn: a.startsOn < window.startsOn ? window.startsOn : a.startsOn,
      endsOn: a.endsOn > window.endsOn ? window.endsOn : a.endsOn,
    });

    const perAsset = fleet.map((a) => {
      const mine = rows.filter((r) => r.assetId === a.id);
      const booked = bookedDays(mine, window);
      return {
        asset: a,
        bookedDays: booked,
        idleDays: days - booked,
        pct: utilisationPct(mine, window),
        costCents: rates && a.dailyRateCents !== null ? a.dailyRateCents * booked : null,
        idleCostCents:
          rates && a.dailyRateCents !== null ? a.dailyRateCents * (days - booked) : null,
      };
    });
    const rateOf = new Map(fleet.map((a) => [a.id, a.dailyRateCents]));
    const byProject = new Map<string, { bookedDays: number; costCents: number | null }>();
    for (const r of rows) {
      if (!rateOf.has(r.assetId)) continue;
      const n = spanDays(clip(r));
      const rate = rates ? (rateOf.get(r.assetId) ?? null) : null;
      const cur = byProject.get(r.projectId) ?? { bookedDays: 0, costCents: rates ? 0 : null };
      byProject.set(r.projectId, {
        bookedDays: cur.bookedDays + n,
        costCents: cur.costCents === null ? null : cur.costCents + (rate === null ? 0 : rate * n),
      });
    }
    const totalBooked = perAsset.reduce((s, a) => s + a.bookedDays, 0);
    return {
      window,
      days,
      fleetPct: fleet.length ? Math.round((totalBooked / (fleet.length * days)) * 100) : 0,
      assets: perAsset,
      projects: [...byProject.entries()]
        .map(([projectId, v]) => ({ projectId, ...v }))
        .sort((x, y) => y.bookedDays - x.bookedDays),
    };
  }

  /** Nova's flags for the fleet, worked out from the current rows each time. */
  async function flags(scope: TenantScope, opts: { idleDays?: number | undefined }) {
    await need(scope, 'plant.assets.view');
    const t = today();
    const fleet = await scope.tx.select().from(assets).limit(MAX_ROWS);
    const allocs = await scope.tx
      .select()
      .from(allocations)
      .where(eq(allocations.status, 'active'))
      .limit(MAX_ROWS * 5);
    const plans = await scope.tx
      .select()
      .from(maintenancePlans)
      .where(eq(maintenancePlans.active, true))
      .limit(MAX_ROWS * 5);
    const rates = await canSeeRates(scope);
    return computeFlags({
      assets: fleet.map((a) => ({
        id: a.id,
        name: a.name,
        assetNumber: a.assetNumber,
        ownership: a.ownership,
        status: a.status,
        dailyRateCents: rates ? a.dailyRateCents : null,
        createdOn: localDateOf(a.createdAt, TIME_ZONE),
      })),
      allocations: allocs,
      plans,
      today: t,
      ...(opts.idleDays ? { idleDays: opts.idleDays } : {}),
    });
  }

  return {
    listAssets,
    createAsset,
    updateAsset,
    listAllocations,
    allocate,
    cancelAllocation,
    listPlans,
    createPlan,
    completePlan,
    records,
    utilisation,
    flags,
    today,
  };
}

export type PlantService = ReturnType<typeof createPlantService>;
