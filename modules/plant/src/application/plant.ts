import { and, asc, desc, eq, gte, lte, ne } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { addDays, localDateOf } from '@archova/time';
import {
  allocatable,
  bookedDays,
  computeFlags,
  contractorNoticeFor,
  NOTICE_COOLDOWN_HOURS,
  normalisePhone,
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
import {
  allocations,
  assets,
  contractorNotices,
  maintenancePlans,
  maintenanceRecords,
} from '../infra/tables';

export type AssetRow = typeof assets.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;
export type PlanRow = typeof maintenancePlans.$inferSelect;
export type RecordRow = typeof maintenanceRecords.$inferSelect;
export type NoticeRow = typeof contractorNotices.$inferSelect;

/** Plant is planned in Australian time; the org has no zone of its own yet. */
export const PLANT_TIME_ZONE = 'Australia/Sydney';
const TIME_ZONE = PLANT_TIME_ZONE;
const MAX_ROWS = 1000;

/** How far back an allocation may start, and how long it may run: a typo in the date can't raise a large charge. */
const MAX_BACKDATE_DAYS = 31;
const MAX_ALLOCATION_DAYS = 366;

export interface PlantDeps {
  access: AccessService;
  /** Throws if the project isn't in the org (`platform`). */
  requireProject: (scope: TenantScope, projectId: string) => Promise<unknown>;
  /** Does the cost code belong to the project and carry a budget line there (`financials`)? */
  costCodeBudgeted: (scope: TenantScope, projectId: string, costCodeId: string) => Promise<boolean>;
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
  /** Who services the machine; the address that Nova's maintenance flags can be sent to. */
  contractorName?: string | undefined;
  contractorEmail?: string | undefined;
  /** Mobile or landline; stored in international form (+61...). */
  contractorPhone?: string | undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (s: string | undefined) => s?.trim() || null;
/** A phone number typed into the register; empty clears it. Stored as +61... */
const phone = (s: string | undefined) => {
  const v = clean(s);
  if (!v) return null;
  const n = normalisePhone(v);
  if (!n)
    throw new AppError('validation_failed', 'Enter a valid phone number.', [
      { path: 'contractorPhone', message: 'Must be a phone number' },
    ]);
  return n;
};
/** An address typed into the register; empty clears it. Anything else must look like an email address. */
const address = (s: string | undefined) => {
  const v = clean(s);
  if (v && (v.length > 254 || !EMAIL.test(v)))
    throw new AppError('validation_failed', 'Enter a valid email address.', [
      { path: 'contractorEmail', message: 'Must be an email address' },
    ]);
  return v ? v.toLowerCase() : null;
};

/** The org's fleet: register, project allocations, maintenance schedule, utilisation and Nova's flags. */
export function createPlantService(deps: PlantDeps) {
  const now = deps.now ?? (() => new Date());
  const today = () => localDateOf(now(), TIME_ZONE);
  const need = (scope: TenantScope, key: string) => deps.access.assert(scope, key);

  /** Daily rates are cost data: only those who manage the register see them. */
  async function canSeeRates(scope: TenantScope) {
    return deps.access.can(scope, 'plant.rates.view');
  }
  /** Setting a rate is for those who may see rates; staff who manage the register can't write what they can't read. */
  async function needRatesToSet(scope: TenantScope, rate: number | undefined) {
    if (rate !== undefined) await deps.access.assert(scope, 'plant.rates.view');
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
    await needRatesToSet(scope, input.dailyRateCents);
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
        contractorName: clean(input.contractorName),
        contractorEmail: address(input.contractorEmail),
        contractorPhone: phone(input.contractorPhone),
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
    await needRatesToSet(scope, patch.dailyRateCents);
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
        ...(patch.contractorName !== undefined
          ? { contractorName: clean(patch.contractorName) }
          : {}),
        ...(patch.contractorPhone !== undefined
          ? { contractorPhone: phone(patch.contractorPhone) }
          : {}),
        ...(patch.contractorEmail !== undefined
          ? { contractorEmail: address(patch.contractorEmail) }
          : {}),
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
    await deps.requireProject(scope, input.projectId);
    if (input.costCodeId) {
      // Tagging a cost code charges that project's budget, so it takes the right to record costs there.
      await deps.access.assert(scope, 'financials.direct_costs.manage', {
        projectId: input.projectId,
      });
      if (!(await deps.costCodeBudgeted(scope, input.projectId, input.costCodeId)))
        throw new AppError('validation_failed', 'That cost code is not on this project’s budget.', [
          { path: 'costCodeId', message: 'Pick a cost code with a budget line on this project' },
        ]);
    }
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
    if (input.costCodeId) {
      if (input.startsOn < addDays(today(), -MAX_BACKDATE_DAYS))
        throw new AppError('validation_failed', 'A costed allocation can’t start that far back.', [
          { path: 'startsOn', message: `Must be within the last ${MAX_BACKDATE_DAYS} days` },
        ]);
      if (spanDays(input) > MAX_ALLOCATION_DAYS)
        throw new AppError('validation_failed', 'A costed allocation can’t run that long.', [
          { path: 'endsOn', message: `Must be within ${MAX_ALLOCATION_DAYS} days of the start` },
        ]);
    }
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

  /**
   * Cancels an allocation that has not started. One that is under way ends yesterday instead (the days used stay on
   * record and are still posted to the budget); one that has finished can't be cancelled.
   */
  async function cancelAllocation(scope: TenantScope, id: string) {
    await need(scope, 'plant.allocations.manage');
    const [cur] = await scope.tx
      .select()
      .from(allocations)
      .where(eq(allocations.id, id))
      .limit(1)
      .for('update');
    if (!cur) throw new AppError('plant.allocation_not_found');
    if (cur.status === 'cancelled')
      throw new AppError('plant.bad_state', 'This allocation is already cancelled.');
    const t = today();
    if (cur.endsOn < t)
      throw new AppError('plant.bad_state', 'This allocation has finished and can’t be cancelled.');
    const [r] = await scope.tx
      .update(allocations)
      .set(cur.startsOn >= t ? { status: 'cancelled' } : { endsOn: addDays(t, -1) })
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
      allocations: allocs.map((a) => ({ ...a })),
      plans,
      today: t,
      ...(opts.idleDays ? { idleDays: opts.idleDays } : {}),
    });
  }

  /**
   * Queue a notice to the machine's contractor about a plan Nova has flagged (due soon, overdue or expired). The text
   * is built here from the plan as it stands, never taken from the caller, so a notice can't say more than the flag
   * does. The machine needs a contractor address; the same plan isn't noticed again inside the cooldown.
   */
  async function notifyContractor(
    scope: TenantScope,
    assetId: string,
    input: {
      planId: string;
      message?: string | undefined;
      /** `email` and `sms` are queued for the worker; `phone` is recorded as sent: the caller texts from their own phone. */
      channel?: 'email' | 'sms' | 'phone' | undefined;
    },
  ) {
    await need(scope, 'plant.assets.manage');
    const channel = input.channel ?? 'email';
    const a = await assetRow(scope, assetId);
    if (channel === 'email' && !a.contractorEmail)
      throw new AppError(
        'plant.bad_state',
        `${a.name} has no contractor email. Add one to the machine first.`,
      );
    if (channel !== 'email' && !a.contractorPhone)
      throw new AppError(
        'plant.bad_state',
        `${a.name} has no contractor phone number. Add one to the machine first.`,
      );
    const [plan] = await scope.tx
      .select()
      .from(maintenancePlans)
      .where(and(eq(maintenancePlans.id, input.planId), eq(maintenancePlans.assetId, a.id)))
      .limit(1)
      .for('update');
    if (!plan) throw new AppError('plant.plan_not_found');
    const notice = contractorNoticeFor(a, plan, today());
    if (!notice)
      throw new AppError(
        'plant.bad_state',
        'Nova has nothing flagged on this job to notify about.',
      );
    const since = new Date(now().getTime() - NOTICE_COOLDOWN_HOURS * 3_600_000);
    const [recent] = await scope.tx
      .select({ id: contractorNotices.id })
      .from(contractorNotices)
      .where(
        and(
          eq(contractorNotices.planId, plan.id),
          eq(contractorNotices.channel, channel),
          gte(contractorNotices.createdAt, since),
        ),
      )
      .limit(1);
    if (recent)
      throw new AppError(
        'plant.bad_state',
        'The contractor was already notified about this job this way in the last day.',
      );
    const [r] = await scope.tx
      .insert(contractorNotices)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        assetId: a.id,
        planId: plan.id,
        senderId: scope.ctx.userId,
        recipientName: a.contractorName ?? a.supplier ?? 'there',
        channel,
        recipientEmail: channel === 'email' ? a.contractorEmail : null,
        recipientPhone: channel === 'email' ? null : a.contractorPhone,
        // Texted from the sender's own phone: nothing for the worker to send.
        ...(channel === 'phone' ? { status: 'sent' as const, sentAt: now() } : {}),
        subject: notice.subject,
        issue: notice.issue,
        dueOn: notice.dueOn,
        message: clean(input.message) ?? '',
      })
      .returning();
    return r!;
  }

  /** Notices sent in the last 90 days, newest first, for one machine or all. */
  async function listNotices(scope: TenantScope, opts: { assetId?: string }) {
    await need(scope, 'plant.assets.view');
    const since = new Date(now().getTime() - 90 * 86_400_000);
    return scope.tx
      .select()
      .from(contractorNotices)
      .where(
        and(
          gte(contractorNotices.createdAt, since),
          opts.assetId ? eq(contractorNotices.assetId, opts.assetId) : undefined,
        ),
      )
      .orderBy(desc(contractorNotices.createdAt), desc(contractorNotices.id))
      .limit(MAX_ROWS);
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
    notifyContractor,
    listNotices,
    today,
  };
}

export type PlantService = ReturnType<typeof createPlantService>;
