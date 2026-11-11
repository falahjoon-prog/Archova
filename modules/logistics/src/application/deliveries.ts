import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import {
  canDo,
  computeFlags,
  draftNotice,
  isDock,
  suggestSlots,
  type Action,
  type DeliveryStatus,
  type DeliveryView,
  type EventKind,
  type Flag,
  type NoticeKind,
  type ResourceKind,
  type ResourceView,
  type SlotSuggestion,
} from '../domain/logistics';
import { deliveries, deliveryEvents, resources, type DeliveryItem } from '../infra/tables';

export type ResourceRow = typeof resources.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type EventRow = typeof deliveryEvents.$inferSelect;

export interface PurchaseOrderRef {
  id: string;
  number: number;
  title: string;
}
export interface LogisticsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  /** Looks up a purchase order on the project (`financials`); null when there is none. */
  purchaseOrder: (
    scope: TenantScope,
    projectId: string,
    id: string,
  ) => Promise<PurchaseOrderRef | null>;
  now?: () => Date;
}

export interface DeliveryInput {
  title: string;
  supplierName: string;
  supplierCompanyId?: string | undefined;
  supplierContact?: string | undefined;
  supplierEmail?: string | undefined;
  supplierPhone?: string | undefined;
  items?: DeliveryItem[] | undefined;
  windowStart: Date;
  windowEnd: Date;
  zoneId?: string | undefined;
  needsLift?: boolean | undefined;
  liftResourceId?: string | undefined;
  liftStart?: Date | undefined;
  liftEnd?: Date | undefined;
  vehicle?: string | undefined;
  accessNotes?: string | undefined;
  commitmentId?: string | undefined;
}

const view = (d: DeliveryRow): DeliveryView => ({
  id: d.id,
  number: d.number,
  title: d.title,
  supplierName: d.supplierName,
  status: d.status,
  windowStart: d.windowStart,
  windowEnd: d.windowEnd,
  zoneId: d.zoneId,
  needsLift: d.needsLift,
  liftResourceId: d.liftResourceId,
  liftStart: d.liftStart,
  liftEnd: d.liftEnd,
  arrivedAt: d.arrivedAt,
});
const resView = (r: ResourceRow): ResourceView => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  capacity: r.capacity,
  active: r.active,
});

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

/**
 * Material delivery scheduling: the project's docks, cranes and hoists, deliveries booked into windows at them, the
 * check-in of what actually arrived, and the rule-based flags, slot finder and supplier notes on top.
 */
export function createLogisticsService(deps: LogisticsDeps) {
  const now = deps.now ?? (() => new Date());
  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  // ---- resources ----------------------------------------------------------------------------------------------

  async function listResources(scope: TenantScope, projectId: string) {
    await need(scope, 'logistics.deliveries.view', projectId);
    return allResources(scope, projectId);
  }
  const allResources = (scope: TenantScope, projectId: string) =>
    scope.tx
      .select()
      .from(resources)
      .where(eq(resources.projectId, projectId))
      .orderBy(asc(resources.kind), asc(resources.name))
      .limit(200);

  async function createResource(
    scope: TenantScope,
    projectId: string,
    input: {
      name: string;
      kind: ResourceKind;
      capacity?: number | undefined;
      note?: string | undefined;
    },
  ) {
    await need(scope, 'logistics.deliveries.manage', projectId);
    const name = input.name.trim();
    const [dup] = await scope.tx
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.projectId, projectId), eq(resources.name, name)))
      .limit(1);
    if (dup)
      throw new AppError('logistics_resource.name_taken', `"${name}" is already on this project.`);
    const [r] = await scope.tx
      .insert(resources)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name,
        kind: input.kind,
        capacity: input.capacity ?? 1,
        note: input.note?.trim() || null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return r!;
  }

  async function updateResource(
    scope: TenantScope,
    projectId: string,
    id: string,
    patch: { name?: string; capacity?: number; active?: boolean; note?: string },
  ) {
    await need(scope, 'logistics.deliveries.manage', projectId);
    const [cur] = await scope.tx
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.projectId, projectId)))
      .limit(1)
      .for('update');
    if (!cur) throw new AppError('logistics_resource.not_found');
    if (patch.name && patch.name.trim() !== cur.name) {
      const [dup] = await scope.tx
        .select({ id: resources.id })
        .from(resources)
        .where(and(eq(resources.projectId, projectId), eq(resources.name, patch.name.trim())))
        .limit(1);
      if (dup)
        throw new AppError(
          'logistics_resource.name_taken',
          `"${patch.name.trim()}" is already used.`,
        );
    }
    const [r] = await scope.tx
      .update(resources)
      .set({
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.capacity ? { capacity: patch.capacity } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.note !== undefined ? { note: patch.note.trim() || null } : {}),
        version: cur.version + 1,
      })
      .where(eq(resources.id, cur.id))
      .returning();
    return r!;
  }

  // ---- deliveries ---------------------------------------------------------------------------------------------

  async function row(scope: TenantScope, projectId: string, id: string, lock = false) {
    const q = scope.tx
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.id, id), eq(deliveries.projectId, projectId)))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('logistics_delivery.not_found');
    return r;
  }

  async function event(
    scope: TenantScope,
    d: { id: string; projectId: string },
    kind: EventKind,
    detail?: string,
  ) {
    await scope.tx.insert(deliveryEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: d.projectId,
      deliveryId: d.id,
      kind,
      detail: detail ?? null,
      byUser: scope.ctx.userId,
    });
  }

  /** A dock for the unloading and, if given, a crane, hoist or lift for the lift; both must be on this project. */
  async function checkPlan(
    scope: TenantScope,
    projectId: string,
    plan: { zoneId?: string | null | undefined; liftResourceId?: string | null | undefined },
  ) {
    const ids = [plan.zoneId, plan.liftResourceId].filter((x): x is string => !!x);
    if (ids.length === 0) return;
    const found = await scope.tx
      .select()
      .from(resources)
      .where(and(eq(resources.projectId, projectId), inArray(resources.id, ids)));
    const zone = found.find((r) => r.id === plan.zoneId);
    if (plan.zoneId && (!zone || !isDock(zone.kind) || !zone.active))
      throw invalid('zoneId', 'Choose an active dock or laydown area.');
    const lift = found.find((r) => r.id === plan.liftResourceId);
    if (plan.liftResourceId && (!lift || isDock(lift.kind) || !lift.active))
      throw invalid('liftResourceId', 'Choose an active crane, hoist, lift or forklift.');
  }

  async function poLink(scope: TenantScope, projectId: string, commitmentId: string) {
    const po = await deps.purchaseOrder(scope, projectId, commitmentId);
    if (!po)
      throw new AppError(
        'logistics_delivery.commitment_not_found',
        'That purchase order is not on this project.',
      );
    return { commitmentId: po.id, commitmentLabel: `PO ${po.number} · ${po.title}` };
  }

  function checkWindow(
    start: Date,
    end: Date,
    lift?: { start?: Date | undefined; end?: Date | undefined },
  ) {
    if (!(end > start)) throw invalid('windowEnd', 'The window must end after it starts.');
    if (!!lift?.start !== !!lift?.end)
      throw invalid('liftEnd', 'Give both a lift start and a lift end, or neither.');
    if (lift?.start && lift.end && !(lift.end > lift.start))
      throw invalid('liftEnd', 'The lift must end after it starts.');
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { from?: Date | undefined; to?: Date | undefined; status?: DeliveryStatus | undefined },
  ) {
    await need(scope, 'logistics.deliveries.view', projectId);
    return scope.tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.projectId, projectId),
          opts.from ? gte(deliveries.windowEnd, opts.from) : undefined,
          opts.to ? lte(deliveries.windowStart, opts.to) : undefined,
          opts.status ? eq(deliveries.status, opts.status) : undefined,
        ),
      )
      .orderBy(asc(deliveries.windowStart), asc(deliveries.number))
      .limit(500);
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'logistics.deliveries.view', projectId);
    const d = await row(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(deliveryEvents)
      .where(eq(deliveryEvents.deliveryId, d.id))
      .orderBy(asc(deliveryEvents.at), asc(deliveryEvents.id))
      .limit(200);
    return { delivery: d, events };
  }

  async function create(scope: TenantScope, projectId: string, input: DeliveryInput) {
    await need(scope, 'logistics.deliveries.manage', projectId);
    await deps.platform.getProject(scope, projectId);
    checkWindow(input.windowStart, input.windowEnd, { start: input.liftStart, end: input.liftEnd });
    await checkPlan(scope, projectId, input);
    const po = input.commitmentId ? await poLink(scope, projectId, input.commitmentId) : null;
    // Serialise numbering per project.
    await scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'deliveries:' + projectId}, 0))`,
    );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${deliveries.number}), 0) + 1` })
      .from(deliveries)
      .where(eq(deliveries.projectId, projectId));
    const [d] = await scope.tx
      .insert(deliveries)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        title: input.title.trim(),
        supplierName: input.supplierName.trim(),
        supplierCompanyId: input.supplierCompanyId ?? null,
        supplierContact: input.supplierContact?.trim() || null,
        supplierEmail: input.supplierEmail?.trim() || null,
        supplierPhone: input.supplierPhone?.trim() || null,
        items: input.items ?? [],
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        zoneId: input.zoneId ?? null,
        needsLift: input.needsLift ?? !!input.liftResourceId,
        liftResourceId: input.liftResourceId ?? null,
        liftStart: input.liftStart ?? null,
        liftEnd: input.liftEnd ?? null,
        vehicle: input.vehicle?.trim() || null,
        accessNotes: input.accessNotes?.trim() || null,
        commitmentId: po?.commitmentId ?? null,
        commitmentLabel: po?.commitmentLabel ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await event(scope, d!, 'created');
    return d!;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    patch: Partial<Omit<DeliveryInput, 'windowStart' | 'windowEnd'>> & {
      /** Pass null to clear the link, the zone or the lift. */
      clear?: ('zoneId' | 'liftResourceId' | 'commitmentId')[] | undefined;
    },
  ) {
    await need(scope, 'logistics.deliveries.manage', projectId);
    const cur = await row(scope, projectId, id, true);
    if (cur.status === 'unloaded' || cur.status === 'cancelled')
      throw new AppError('logistics_delivery.bad_state', `This delivery is ${cur.status}.`);
    const clear = new Set(patch.clear ?? []);
    const zoneId = clear.has('zoneId') ? null : (patch.zoneId ?? cur.zoneId);
    const liftResourceId = clear.has('liftResourceId')
      ? null
      : (patch.liftResourceId ?? cur.liftResourceId);
    const liftStart = clear.has('liftResourceId') ? null : (patch.liftStart ?? cur.liftStart);
    const liftEnd = clear.has('liftResourceId') ? null : (patch.liftEnd ?? cur.liftEnd);
    checkWindow(cur.windowStart, cur.windowEnd, {
      start: liftStart ?? undefined,
      end: liftEnd ?? undefined,
    });
    await checkPlan(scope, projectId, {
      zoneId: zoneId === cur.zoneId ? undefined : zoneId,
      liftResourceId: liftResourceId === cur.liftResourceId ? undefined : liftResourceId,
    });
    let po: { commitmentId: string | null; commitmentLabel: string | null } = {
      commitmentId: cur.commitmentId,
      commitmentLabel: cur.commitmentLabel,
    };
    if (clear.has('commitmentId')) po = { commitmentId: null, commitmentLabel: null };
    else if (patch.commitmentId && patch.commitmentId !== cur.commitmentId)
      po = await poLink(scope, projectId, patch.commitmentId);
    const [r] = await scope.tx
      .update(deliveries)
      .set({
        ...(patch.title ? { title: patch.title.trim() } : {}),
        ...(patch.supplierName ? { supplierName: patch.supplierName.trim() } : {}),
        ...(patch.supplierCompanyId ? { supplierCompanyId: patch.supplierCompanyId } : {}),
        ...(patch.supplierContact !== undefined
          ? { supplierContact: patch.supplierContact.trim() || null }
          : {}),
        ...(patch.supplierEmail !== undefined
          ? { supplierEmail: patch.supplierEmail.trim() || null }
          : {}),
        ...(patch.supplierPhone !== undefined
          ? { supplierPhone: patch.supplierPhone.trim() || null }
          : {}),
        ...(patch.items ? { items: patch.items } : {}),
        ...(patch.vehicle !== undefined ? { vehicle: patch.vehicle.trim() || null } : {}),
        ...(patch.accessNotes !== undefined
          ? { accessNotes: patch.accessNotes.trim() || null }
          : {}),
        zoneId,
        liftResourceId,
        liftStart,
        liftEnd,
        needsLift: patch.needsLift ?? (liftResourceId ? true : cur.needsLift),
        ...po,
        version: cur.version + 1,
      })
      .where(eq(deliveries.id, cur.id))
      .returning();
    await event(scope, cur, 'updated');
    return r!;
  }

  /** Site staff log what actually happened at the gate: the truck arrived, or the load is off. */
  async function checkIn(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { event: 'arrived' | 'unloaded'; at?: Date | undefined; note?: string | undefined },
  ) {
    await need(scope, 'logistics.deliveries.checkin', projectId);
    const cur = await row(scope, projectId, id, true);
    const at = input.at ?? now();
    if (at.getTime() > now().getTime() + 5 * 60_000)
      throw invalid('at', 'A check-in cannot be in the future.');
    const action: Action = input.event === 'arrived' ? 'arrive' : 'unload';
    if (!canDo(cur.status, action))
      throw new AppError(
        'logistics_delivery.bad_state',
        `A ${cur.status} delivery can't be marked ${input.event}.`,
      );
    if (input.event === 'unloaded' && cur.arrivedAt && at < cur.arrivedAt)
      throw invalid('at', 'It cannot be unloaded before it arrived.');
    const [r] = await scope.tx
      .update(deliveries)
      .set(
        input.event === 'arrived'
          ? { status: 'arrived', arrivedAt: at, statusReason: null, version: cur.version + 1 }
          : { status: 'unloaded', unloadedAt: at, version: cur.version + 1 },
      )
      .where(eq(deliveries.id, cur.id))
      .returning();
    await event(scope, cur, input.event, input.note?.trim() || undefined);
    return r!;
  }

  /** Delay, miss, cancel or reschedule: the coordinator's calls on a delivery. */
  async function change(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: {
      action: 'delay' | 'miss' | 'cancel' | 'reschedule';
      reason?: string | undefined;
      windowStart?: Date | undefined;
      windowEnd?: Date | undefined;
      zoneId?: string | undefined;
      liftResourceId?: string | undefined;
    },
  ) {
    await need(scope, 'logistics.deliveries.manage', projectId);
    const cur = await row(scope, projectId, id, true);
    if (!canDo(cur.status, input.action))
      throw new AppError(
        'logistics_delivery.bad_state',
        `A ${cur.status} delivery can't be ${input.action === 'miss' ? 'marked missed' : input.action === 'delay' ? 'marked delayed' : input.action === 'cancel' ? 'cancelled' : 'rescheduled'}.`,
      );
    const reason = input.reason?.trim() || null;
    if ((input.action === 'delay' || input.action === 'cancel') && !reason)
      throw invalid('reason', 'Say why.');
    const hasWindow = !!input.windowStart || !!input.windowEnd;
    if (input.action === 'reschedule' && !(input.windowStart && input.windowEnd))
      throw invalid('windowStart', 'Give the new window.');
    if (hasWindow && !(input.windowStart && input.windowEnd))
      throw invalid('windowStart', 'Give both ends of the new window.');
    if (input.windowStart && input.windowEnd) checkWindow(input.windowStart, input.windowEnd);
    await checkPlan(scope, projectId, input);
    const moved = input.windowStart && input.windowEnd;
    // A lift booked inside the old window keeps its place relative to the new one.
    const shift = moved ? input.windowStart!.getTime() - cur.windowStart.getTime() : 0;
    const status: DeliveryStatus =
      input.action === 'reschedule'
        ? 'scheduled'
        : input.action === 'delay'
          ? 'delayed'
          : input.action === 'miss'
            ? 'missed'
            : 'cancelled';
    const [r] = await scope.tx
      .update(deliveries)
      .set({
        status,
        statusReason: reason,
        ...(moved
          ? {
              windowStart: input.windowStart!,
              windowEnd: input.windowEnd!,
              liftStart: cur.liftStart ? new Date(cur.liftStart.getTime() + shift) : null,
              liftEnd: cur.liftEnd ? new Date(cur.liftEnd.getTime() + shift) : null,
            }
          : {}),
        ...(input.zoneId ? { zoneId: input.zoneId } : {}),
        ...(input.liftResourceId ? { liftResourceId: input.liftResourceId, needsLift: true } : {}),
        version: cur.version + 1,
      })
      .where(eq(deliveries.id, cur.id))
      .returning();
    const kind: EventKind = input.action === 'reschedule' ? 'rescheduled' : (status as EventKind);
    await event(
      scope,
      cur,
      kind,
      [
        moved ? `${cur.windowStart.toISOString()} → ${input.windowStart!.toISOString()}` : null,
        reason,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    );
    return r!;
  }

  // ---- Nova: rule-based flags, slot finder and supplier notes -----------------------------------------------------

  async function context(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    const res = await allResources(scope, projectId);
    return { project, res };
  }

  async function insights(scope: TenantScope, projectId: string) {
    await need(scope, 'logistics.deliveries.view', projectId);
    const { project, res } = await context(scope, projectId);
    const at = now();
    const rows = await scope.tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.projectId, projectId),
          gte(deliveries.windowEnd, new Date(at.getTime() - 3 * 86_400_000)),
          lte(deliveries.windowStart, new Date(at.getTime() + 14 * 86_400_000)),
        ),
      )
      .orderBy(asc(deliveries.windowStart))
      .limit(500);
    const flags = computeFlags(rows.map(view), res.map(resView), at, project.timezone);
    const today = localDateOf(at, project.timezone);
    const todays = rows.filter((d) => localDateOf(d.windowStart, project.timezone) === today);
    const count = (...ks: Flag['kind'][]) =>
      new Set(flags.filter((f) => ks.includes(f.kind)).map((f) => f.deliveryId)).size;
    return {
      asOf: at,
      today,
      counts: {
        today: todays.filter((d) => d.status !== 'cancelled').length,
        arrivedToday: todays.filter((d) => d.status === 'arrived' || d.status === 'unloaded')
          .length,
        late: count('late', 'overdue'),
        clashes: count('double_booked', 'lift_clash'),
        noPlan: count('no_plan'),
      },
      flags,
    };
  }

  async function suggest(
    scope: TenantScope,
    projectId: string,
    input: {
      durationMinutes: number;
      fromDate?: string | undefined;
      days?: number | undefined;
      zoneId?: string | undefined;
      needsLift?: boolean | undefined;
      liftMinutes?: number | undefined;
      liftResourceId?: string | undefined;
      /** A delivery being moved: its own booking does not count as a clash. */
      ignoreDeliveryId?: string | undefined;
    },
  ): Promise<SlotSuggestion[]> {
    await need(scope, 'logistics.deliveries.view', projectId);
    const { project, res } = await context(scope, projectId);
    const at = now();
    const from = input.fromDate ?? localDateOf(at, project.timezone);
    const days = input.days ?? 7;
    const rows = await scope.tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.projectId, projectId),
          gte(deliveries.windowEnd, new Date(at.getTime() - 86_400_000)),
          lte(deliveries.windowStart, new Date(at.getTime() + (days + 30) * 86_400_000)),
        ),
      )
      .limit(1000);
    return suggestSlots(
      {
        fromDate: from,
        days,
        durationMinutes: input.durationMinutes,
        needsLift: input.needsLift ?? false,
        ...(input.zoneId ? { zoneId: input.zoneId } : {}),
        ...(input.liftMinutes ? { liftMinutes: input.liftMinutes } : {}),
        ...(input.liftResourceId ? { liftResourceId: input.liftResourceId } : {}),
      },
      rows.filter((d) => d.id !== input.ignoreDeliveryId).map(view),
      res.map(resView),
      at,
      project.timezone,
    );
  }

  /** A draft for the coordinator to edit and send. For a reschedule it also finds the slot to offer. */
  async function notice(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { kind: NoticeKind; reason?: string | undefined; senderName?: string | undefined },
  ) {
    await need(scope, 'logistics.deliveries.manage', projectId);
    const d = await row(scope, projectId, id);
    const { project, res } = await context(scope, projectId);
    const name = (rid: string | null) => res.find((r) => r.id === rid)?.name ?? null;
    let proposed: (SlotSuggestion & { zoneName: string | null }) | undefined;
    if (input.kind === 'reschedule') {
      const minutes = Math.max(
        15,
        Math.round((d.windowEnd.getTime() - d.windowStart.getTime()) / 60_000),
      );
      const liftMinutes =
        d.liftStart && d.liftEnd
          ? Math.round((d.liftEnd.getTime() - d.liftStart.getTime()) / 60_000)
          : undefined;
      const [first] = await suggest(scope, projectId, {
        durationMinutes: minutes,
        needsLift: d.needsLift,
        ...(d.zoneId ? { zoneId: d.zoneId } : {}),
        ...(d.liftResourceId ? { liftResourceId: d.liftResourceId } : {}),
        ...(liftMinutes ? { liftMinutes } : {}),
        ignoreDeliveryId: d.id,
      });
      if (first) proposed = { ...first, zoneName: name(first.zoneId) };
    }
    const text = draftNotice(
      {
        kind: input.kind,
        projectName: project.name,
        senderName: input.senderName?.trim() || 'The site team',
        supplierName: d.supplierName,
        supplierContact: d.supplierContact,
        deliveryNumber: d.number,
        title: d.title,
        windowStart: d.windowStart,
        windowEnd: d.windowEnd,
        zoneName: name(d.zoneId),
        liftName: name(d.liftResourceId),
        accessNotes: d.accessNotes,
        poLabel: d.commitmentLabel,
        ...(proposed ? { proposed } : {}),
        reason: input.reason?.trim() || d.statusReason,
      },
      project.timezone,
    );
    await event(scope, d, 'notice_drafted', input.kind);
    return { to: d.supplierEmail, ...text, proposed: proposed ?? null };
  }

  return {
    listResources,
    createResource,
    updateResource,
    list,
    get,
    create,
    update,
    checkIn,
    change,
    insights,
    suggest,
    notice,
  };
}

export type LogisticsService = ReturnType<typeof createLogisticsService>;
