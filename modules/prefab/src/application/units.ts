import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import type { LocalDate } from '@archova/time';
import { localDateOf } from '@archova/time';
import {
  GATE,
  TRANSITIONS,
  canDo,
  computeFlags,
  defaultChecks,
  failedChecks,
  openChecks,
  planDates,
  summarise,
  type Action,
  type CheckResult,
  type CheckStage,
  type CheckView,
  type UnitKind,
  type UnitStatus,
  type UnitView,
} from '../domain/prefab';
import { qaChecks, unitEvents, units } from '../infra/tables';

export type UnitRow = typeof units.$inferSelect;
export type CheckRow = typeof qaChecks.$inferSelect;
export type EventRow = typeof unitEvents.$inferSelect;
export interface QaTally {
  total: number;
  done: number;
  failed: number;
}
export type UnitWithQa = UnitRow & { qa: QaTally };

export interface DeliveryRef {
  id: string;
  number: number;
  title: string;
}
export interface PrefabDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  /** Looks up a material delivery on the project (`logistics`); null when there is none. */
  delivery: (scope: TenantScope, projectId: string, id: string) => Promise<DeliveryRef | null>;
  now?: () => Date;
}

export interface UnitInput {
  code: string;
  name: string;
  kind: UnitKind;
  factoryName?: string | undefined;
  supplierCompanyId?: string | undefined;
  location?: string | undefined;
  installSequence?: number | undefined;
  weightKg?: number | undefined;
  dimensions?: string | undefined;
  fabStart?: LocalDate | undefined;
  fabDue?: LocalDate | undefined;
  shipDate?: LocalDate | undefined;
  installDate?: LocalDate | undefined;
  deliveryId?: string | undefined;
  notes?: string | undefined;
  /** Start with the standard QA checklist for the kind. Default true. */
  standardChecks?: boolean | undefined;
}
export type UnitPatch = Partial<Omit<UnitInput, 'kind' | 'standardChecks'>> & {
  progressPct?: number | undefined;
  /** Null clears a link or a date; undefined leaves it. */
  clear?:
    | readonly (
        'installSequence' | 'fabStart' | 'fabDue' | 'shipDate' | 'installDate' | 'deliveryId'
      )[]
    | undefined;
};

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);
const text = (v: string | undefined) => v?.trim() || null;

const EVENT_FOR: Record<Action, string> = {
  start: 'started',
  hold: 'held',
  resume: 'resumed',
  ready: 'ready',
  ship: 'shipped',
  deliver: 'delivered',
  install: 'installed',
  reject: 'rejected',
  reopen: 'reopened',
};

const checkView = (c: CheckRow): CheckView => ({
  id: c.id,
  stage: c.stage,
  required: c.required,
  result: c.result,
});

/**
 * Prefabricated and modular construction: the units built off site, their QA gates, the ship and install schedule, and
 * the rule-based flags and date plan on top.
 */
export function createPrefabService(deps: PrefabDeps) {
  const now = deps.now ?? (() => new Date());
  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  async function row(scope: TenantScope, projectId: string, id: string, lock = false) {
    const q = scope.tx
      .select()
      .from(units)
      .where(and(eq(units.id, id), eq(units.projectId, projectId)))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('prefab_unit.not_found');
    return r;
  }

  const checksOf = (scope: TenantScope, unitIds: string[]) =>
    unitIds.length === 0
      ? Promise.resolve([] as CheckRow[])
      : scope.tx
          .select()
          .from(qaChecks)
          .where(inArray(qaChecks.unitId, unitIds))
          .orderBy(asc(qaChecks.sortOrder), asc(qaChecks.id))
          .limit(5000);

  const tally = (checks: CheckRow[]): QaTally => ({
    total: checks.length,
    done: checks.filter((c) => c.result === 'pass' || c.result === 'na').length,
    failed: checks.filter((c) => c.result === 'fail').length,
  });

  async function withQa(scope: TenantScope, rows: UnitRow[]): Promise<UnitWithQa[]> {
    const checks = await checksOf(
      scope,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, qa: tally(checks.filter((c) => c.unitId === r.id)) }));
  }

  async function event(
    scope: TenantScope,
    u: { id: string; projectId: string },
    kind: string,
    detail?: string,
  ) {
    await scope.tx.insert(unitEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: u.projectId,
      unitId: u.id,
      kind,
      detail: detail ?? null,
      byUser: scope.ctx.userId,
    });
  }

  async function deliveryLink(scope: TenantScope, projectId: string, id: string) {
    const d = await deps.delivery(scope, projectId, id);
    if (!d)
      throw new AppError('prefab_unit.delivery_not_found', 'That delivery is not on this project.');
    return { deliveryId: d.id, deliveryLabel: `Delivery #${d.number} · ${d.title}` };
  }

  async function codeFree(scope: TenantScope, projectId: string, code: string, exceptId?: string) {
    const [dup] = await scope.tx
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.projectId, projectId), eq(units.code, code)))
      .limit(1);
    if (dup && dup.id !== exceptId)
      throw new AppError('prefab_unit.code_taken', `"${code}" is already used on this project.`);
  }

  // ---- units ------------------------------------------------------------------------------------------------

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: UnitStatus | undefined },
  ) {
    await need(scope, 'prefab.units.view', projectId);
    const rows = await scope.tx
      .select()
      .from(units)
      .where(
        and(
          eq(units.projectId, projectId),
          opts.status ? eq(units.status, opts.status) : undefined,
        ),
      )
      .orderBy(sql`${units.installSequence} asc nulls last`, asc(units.number))
      .limit(1000);
    return withQa(scope, rows);
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'prefab.units.view', projectId);
    const u = await row(scope, projectId, id);
    const checks = await checksOf(scope, [u.id]);
    const events = await scope.tx
      .select()
      .from(unitEvents)
      .where(eq(unitEvents.unitId, u.id))
      .orderBy(asc(unitEvents.at), asc(unitEvents.id))
      .limit(200);
    return { unit: { ...u, qa: tally(checks) }, checks, events };
  }

  function checkDates(d: {
    fabStart?: string | null | undefined;
    fabDue?: string | null | undefined;
  }) {
    if (d.fabStart && d.fabDue && d.fabDue < d.fabStart)
      throw invalid('fabDue', 'Fabrication must finish on or after the day it starts.');
  }

  async function create(scope: TenantScope, projectId: string, input: UnitInput) {
    await need(scope, 'prefab.units.write', projectId);
    await deps.platform.getProject(scope, projectId);
    checkDates(input);
    const code = input.code.trim();
    await codeFree(scope, projectId, code);
    const link = input.deliveryId ? await deliveryLink(scope, projectId, input.deliveryId) : null;
    // Serialise numbering per project.
    await scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'prefab:' + projectId}, 0))`,
    );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${units.number}), 0) + 1` })
      .from(units)
      .where(eq(units.projectId, projectId));
    const [u] = await scope.tx
      .insert(units)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        code,
        name: input.name.trim(),
        kind: input.kind,
        factoryName: text(input.factoryName),
        supplierCompanyId: input.supplierCompanyId ?? null,
        location: text(input.location),
        installSequence: input.installSequence ?? null,
        weightKg: input.weightKg ?? null,
        dimensions: text(input.dimensions),
        fabStart: input.fabStart ?? null,
        fabDue: input.fabDue ?? null,
        shipDate: input.shipDate ?? null,
        installDate: input.installDate ?? null,
        deliveryId: link?.deliveryId ?? null,
        deliveryLabel: link?.deliveryLabel ?? null,
        notes: text(input.notes),
        createdBy: scope.ctx.userId,
      })
      .returning();
    if (input.standardChecks ?? true) {
      const templates = defaultChecks(input.kind);
      await scope.tx.insert(qaChecks).values(
        templates.map((t, i) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          unitId: u!.id,
          stage: t.stage,
          label: t.label,
          required: t.required,
          sortOrder: i,
        })),
      );
    }
    await event(scope, u!, 'created');
    return u!;
  }

  async function update(scope: TenantScope, projectId: string, id: string, patch: UnitPatch) {
    await need(scope, 'prefab.units.write', projectId);
    const cur = await row(scope, projectId, id, true);
    const cleared = new Set(patch.clear ?? []);
    const pick = <K extends 'fabStart' | 'fabDue' | 'shipDate' | 'installDate'>(k: K) =>
      cleared.has(k) ? null : patch[k] !== undefined ? patch[k]! : cur[k];
    const next = {
      fabStart: pick('fabStart'),
      fabDue: pick('fabDue'),
      shipDate: pick('shipDate'),
      installDate: pick('installDate'),
    };
    checkDates(next);
    if (patch.code && patch.code.trim() !== cur.code)
      await codeFree(scope, projectId, patch.code.trim(), cur.id);
    let link: { deliveryId: string | null; deliveryLabel: string | null } | undefined;
    if (cleared.has('deliveryId')) link = { deliveryId: null, deliveryLabel: null };
    else if (patch.deliveryId) link = await deliveryLink(scope, projectId, patch.deliveryId);
    const moved = (['fabStart', 'fabDue', 'shipDate', 'installDate'] as const).filter(
      (k) => next[k] !== cur[k],
    );
    const [u] = await scope.tx
      .update(units)
      .set({
        ...(patch.code ? { code: patch.code.trim() } : {}),
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.factoryName !== undefined ? { factoryName: text(patch.factoryName) } : {}),
        ...(patch.supplierCompanyId ? { supplierCompanyId: patch.supplierCompanyId } : {}),
        ...(patch.location !== undefined ? { location: text(patch.location) } : {}),
        ...(cleared.has('installSequence')
          ? { installSequence: null }
          : patch.installSequence !== undefined
            ? { installSequence: patch.installSequence }
            : {}),
        ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg } : {}),
        ...(patch.dimensions !== undefined ? { dimensions: text(patch.dimensions) } : {}),
        ...(patch.progressPct !== undefined ? { progressPct: patch.progressPct } : {}),
        ...(patch.notes !== undefined ? { notes: text(patch.notes) } : {}),
        ...next,
        ...(link ?? {}),
        version: cur.version + 1,
      })
      .where(eq(units.id, cur.id))
      .returning();
    await event(
      scope,
      cur,
      'updated',
      moved.length > 0 ? `Dates changed: ${moved.join(', ')}` : undefined,
    );
    return (await withQa(scope, [u!]))[0]!;
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { action: Action; reason?: string | undefined },
  ) {
    await need(scope, 'prefab.units.write', projectId);
    const cur = await row(scope, projectId, id, true);
    if (!canDo(cur.status, input.action))
      throw new AppError(
        'prefab_unit.bad_state',
        `A unit that is ${cur.status.replaceAll('_', ' ')} cannot ${input.action}.`,
      );
    const reason = input.reason?.trim() || undefined;
    if ((input.action === 'reject' || input.action === 'hold') && !reason)
      throw invalid('reason', 'Say why.');
    const gate = GATE[input.action];
    if (gate) {
      const open = openChecks((await checksOf(scope, [cur.id])).map(checkView), gate);
      if (open.length > 0)
        throw new AppError(
          'prefab_unit.qa_open',
          `${open.length} required ${gate} check${open.length === 1 ? ' is' : 's are'} not passed yet.`,
        );
    }
    const at = now();
    const to = TRANSITIONS[input.action].to;
    const [u] = await scope.tx
      .update(units)
      .set({
        status: to,
        statusReason: input.action === 'hold' || input.action === 'reject' ? reason! : null,
        ...(input.action === 'ready' ? { progressPct: 100 } : {}),
        ...(input.action === 'ship' ? { shippedAt: at } : {}),
        ...(input.action === 'deliver' ? { deliveredAt: at } : {}),
        ...(input.action === 'install' ? { installedAt: at } : {}),
        ...(input.action === 'reopen'
          ? { progressPct: 0, shippedAt: null, deliveredAt: null, installedAt: null }
          : {}),
        version: cur.version + 1,
      })
      .where(eq(units.id, cur.id))
      .returning();
    await event(scope, cur, EVENT_FOR[input.action], reason);
    return (await withQa(scope, [u!]))[0]!;
  }

  // ---- QA checks --------------------------------------------------------------------------------------------

  async function addCheck(
    scope: TenantScope,
    projectId: string,
    unitId: string,
    input: { stage: CheckStage; label: string; required?: boolean | undefined },
  ) {
    await need(scope, 'prefab.units.write', projectId);
    const u = await row(scope, projectId, unitId, true);
    const [m] = await scope.tx
      .select({ m: sql<number>`coalesce(max(${qaChecks.sortOrder}), -1) + 1` })
      .from(qaChecks)
      .where(eq(qaChecks.unitId, u.id));
    const [c] = await scope.tx
      .insert(qaChecks)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        unitId: u.id,
        stage: input.stage,
        label: input.label.trim(),
        required: input.required ?? true,
        sortOrder: Number(m!.m),
      })
      .returning();
    await event(scope, u, 'check_added', c!.label);
    return c!;
  }

  async function recordCheck(
    scope: TenantScope,
    projectId: string,
    unitId: string,
    checkId: string,
    input: { result: CheckResult; note?: string | undefined },
  ) {
    await need(scope, 'prefab.units.write', projectId);
    const u = await row(scope, projectId, unitId, true);
    const [cur] = await scope.tx
      .select()
      .from(qaChecks)
      .where(and(eq(qaChecks.id, checkId), eq(qaChecks.unitId, u.id)))
      .limit(1)
      .for('update');
    if (!cur) throw new AppError('prefab_check.not_found');
    const note = input.note?.trim() || null;
    if (input.result === 'fail' && !note) throw invalid('note', 'Say what failed.');
    const [c] = await scope.tx
      .update(qaChecks)
      .set({
        result: input.result,
        note,
        checkedAt: input.result === 'pending' ? null : now(),
        checkedBy: input.result === 'pending' ? null : scope.ctx.userId,
      })
      .where(eq(qaChecks.id, cur.id))
      .returning();
    await event(
      scope,
      u,
      'check_recorded',
      `${cur.label}: ${input.result}${note ? ` (${note})` : ''}`,
    );
    // A failed factory check stops a unit that is still being made, or is waiting to ship.
    if (
      input.result === 'fail' &&
      cur.stage === 'factory' &&
      (u.status === 'in_fabrication' || u.status === 'ready_to_ship')
    ) {
      const why = `Failed: ${cur.label} (${note})`;
      await scope.tx
        .update(units)
        .set({ status: 'qa_hold', statusReason: why, version: u.version + 1 })
        .where(eq(units.id, u.id));
      await event(scope, u, 'held', why);
    }
    return c!;
  }

  // ---- Nova: rule-based flags and the date plan -------------------------------------------------------------

  async function insights(scope: TenantScope, projectId: string) {
    await need(scope, 'prefab.units.view', projectId);
    const project = await deps.platform.getProject(scope, projectId);
    const at = now();
    const today = localDateOf(at, project.timezone);
    const rows = await scope.tx
      .select()
      .from(units)
      .where(eq(units.projectId, projectId))
      .limit(1000);
    const checks = await checksOf(
      scope,
      rows.map((r) => r.id),
    );
    const views: UnitView[] = rows.map((u) => {
      const mine = checks.filter((c) => c.unitId === u.id).map(checkView);
      return {
        id: u.id,
        number: u.number,
        code: u.code,
        name: u.name,
        status: u.status,
        progressPct: u.progressPct,
        installSequence: u.installSequence,
        fabStart: u.fabStart,
        fabDue: u.fabDue,
        shipDate: u.shipDate,
        installDate: u.installDate,
        hasDelivery: u.deliveryId !== null,
        failedChecks: failedChecks(mine).length,
        openFactoryChecks: openChecks(mine, 'factory').length,
        openSiteChecks: openChecks(mine, 'site').length,
      };
    });
    return { asOf: at, today, summary: summarise(views, today), flags: computeFlags(views, today) };
  }

  async function plan(
    scope: TenantScope,
    projectId: string,
    input: {
      installDate: LocalDate;
      kind: UnitKind;
      fabDays?: number | undefined;
      transitDays?: number | undefined;
      bufferDays?: number | undefined;
    },
  ) {
    await need(scope, 'prefab.units.view', projectId);
    return planDates(input);
  }

  return { list, get, create, update, transition, addCheck, recordCheck, insights, plan };
}

export type PrefabService = ReturnType<typeof createPrefabService>;
