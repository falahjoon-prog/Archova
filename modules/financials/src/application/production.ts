import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { isLocalDate, localDateOf } from '@archova/time';
import {
  itemProgress,
  productionCurve,
  rateFlags,
  type Entry,
  type Item,
} from '../domain/production';
import { productionEntries, productionItems } from '../infra/tables';

export interface ProductionDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

export interface ProductionItemInput {
  name: string;
  uom: string;
  trade?: string | null;
  location?: string | null;
  plannedQuantity: number;
  plannedStart: string;
  plannedFinish: string;
}

export type ProductionItemPatch = Partial<ProductionItemInput> & { archived?: boolean };

export interface ProductionEntryInput {
  loggedOn: string;
  quantity: number;
  crew?: string | null;
  note?: string | null;
}

const num = (v: string) => Number(v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const bad = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);
const text = (v: string | null | undefined, path: string, max: number) => {
  const t = v?.trim();
  if (!t) return null;
  if (t.length > max) throw bad(path, `Keep it to ${max} characters.`);
  return t;
};

/**
 * Production tracking: custom production items per project with a planned quantity and window, dated quantity
 * installed against them, the curve of the two, and Nova's rate-drop flags. Builder staff only, like the budget.
 */
export function createProductionService(deps: ProductionDeps) {
  const now = deps.now ?? (() => new Date());
  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can use production tracking.");
  };
  const today = async (scope: TenantScope, projectId: string) =>
    localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);

  const toItem = (r: typeof productionItems.$inferSelect): Item => ({
    id: r.id,
    name: r.name,
    uom: r.uom,
    trade: r.trade,
    location: r.location,
    plannedQuantity: num(r.plannedQuantity),
    plannedStart: r.plannedStart,
    plannedFinish: r.plannedFinish,
  });

  function check(i: ProductionItemInput) {
    const name = text(i.name, 'name', 80);
    const uom = text(i.uom, 'uom', 20);
    if (!name) throw bad('name', 'Name the production item.');
    if (!uom) throw bad('uom', 'Enter a unit, such as "panels" or "LF".');
    if (!(i.plannedQuantity > 0) || !Number.isFinite(i.plannedQuantity))
      throw bad('plannedQuantity', 'Planned quantity must be more than zero.');
    if (!isLocalDate(i.plannedStart)) throw bad('plannedStart', 'Enter a start date.');
    if (!isLocalDate(i.plannedFinish)) throw bad('plannedFinish', 'Enter a finish date.');
    if (i.plannedFinish < i.plannedStart)
      throw bad('plannedFinish', 'Finish cannot be before the start.');
    return {
      name,
      uom,
      trade: text(i.trade, 'trade', 60),
      location: text(i.location, 'location', 80),
      plannedQuantity: i.plannedQuantity.toFixed(2),
      plannedStart: i.plannedStart,
      plannedFinish: i.plannedFinish,
    };
  }

  async function createItem(scope: TenantScope, projectId: string, input: ProductionItemInput) {
    await need(scope, 'financials.budget.manage', projectId);
    const values = check(input);
    const [row] = await scope.tx
      .insert(productionItems)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        ...values,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function itemOrThrow(scope: TenantScope, projectId: string, itemId: string) {
    const [row] = await scope.tx
      .select()
      .from(productionItems)
      .where(and(eq(productionItems.id, itemId), eq(productionItems.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('financials.production.item_not_found');
    return row;
  }

  async function updateItem(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    patch: ProductionItemPatch,
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    const cur = await itemOrThrow(scope, projectId, itemId);
    const merged = check({
      name: patch.name ?? cur.name,
      uom: patch.uom ?? cur.uom,
      trade: patch.trade === undefined ? cur.trade : patch.trade,
      location: patch.location === undefined ? cur.location : patch.location,
      plannedQuantity: patch.plannedQuantity ?? num(cur.plannedQuantity),
      plannedStart: patch.plannedStart ?? cur.plannedStart,
      plannedFinish: patch.plannedFinish ?? cur.plannedFinish,
    });
    const [row] = await scope.tx
      .update(productionItems)
      .set({
        ...merged,
        ...(patch.archived === undefined ? {} : { archivedAt: patch.archived ? now() : null }),
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(productionItems.id, itemId))
      .returning();
    return row!;
  }

  /** Adds quantity installed for a day. Entries are never edited; a negative entry corrects and needs a note. */
  async function logEntry(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    input: ProductionEntryInput,
  ) {
    await need(scope, 'financials.production.log', projectId);
    if (!Number.isFinite(input.quantity) || input.quantity === 0)
      throw bad('quantity', 'Enter a quantity other than zero.');
    if (!isLocalDate(input.loggedOn)) throw bad('loggedOn', 'Enter the day the work was done.');
    const note = text(input.note, 'note', 300);
    if (input.quantity < 0 && !note) throw bad('note', 'Say why the quantity is being taken off.');
    if (input.loggedOn > (await today(scope, projectId)))
      throw bad('loggedOn', 'Quantity cannot be logged for a future day.');
    const [item] = await scope.tx
      .select()
      .from(productionItems)
      .where(and(eq(productionItems.id, itemId), eq(productionItems.projectId, projectId)))
      .for('update');
    if (!item) throw new AppError('financials.production.item_not_found');
    if (item.archivedAt)
      throw new AppError('financials.production.item_archived', 'This item is archived.');
    const total = r2(
      (
        await scope.tx
          .select({ q: productionEntries.quantity })
          .from(productionEntries)
          .where(eq(productionEntries.itemId, itemId))
      ).reduce((a, e) => a + num(e.q), 0) + input.quantity,
    );
    if (total < 0) throw bad('quantity', 'That would take the quantity installed below zero.');
    const id = uuidv7();
    const [created] = await scope.tx
      .insert(productionEntries)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        itemId,
        loggedOn: input.loggedOn,
        quantity: input.quantity.toFixed(2),
        crew: text(input.crew, 'crew', 60),
        note,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.production_entry',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    return { entry: created!, quantityInstalled: total };
  }

  async function listEntries(scope: TenantScope, projectId: string, itemId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await itemOrThrow(scope, projectId, itemId);
    return scope.tx
      .select()
      .from(productionEntries)
      .where(and(eq(productionEntries.projectId, projectId), eq(productionEntries.itemId, itemId)))
      .orderBy(desc(productionEntries.loggedOn), desc(productionEntries.createdAt))
      .limit(100);
  }

  /** Items with progress, the curve per unit, trade and location rollups, and Nova's rate-drop flags. */
  async function report(
    scope: TenantScope,
    projectId: string,
    filter: { trade?: string; location?: string; includeArchived?: boolean },
  ) {
    await need(scope, 'financials.budget.read', projectId);
    const asOf = await today(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(productionItems)
      .where(
        and(
          eq(productionItems.projectId, projectId),
          filter.includeArchived ? undefined : isNull(productionItems.archivedAt),
          filter.trade ? eq(productionItems.trade, filter.trade) : undefined,
          filter.location ? eq(productionItems.location, filter.location) : undefined,
        ),
      )
      .orderBy(asc(productionItems.name));
    const items = rows.map(toItem);
    const ids = new Set(items.map((i) => i.id));
    const entries: Entry[] = (
      await scope.tx
        .select()
        .from(productionEntries)
        .where(eq(productionEntries.projectId, projectId))
    )
      .filter((e) => ids.has(e.itemId))
      .map((e) => ({
        itemId: e.itemId,
        loggedOn: e.loggedOn,
        quantity: num(e.quantity),
        crew: e.crew,
      }));
    const actualBy = new Map<string, number>();
    for (const e of entries) actualBy.set(e.itemId, (actualBy.get(e.itemId) ?? 0) + e.quantity);

    const rowsOut = rows.map((row, i) => ({
      row,
      progress: itemProgress(items[i]!, actualBy.get(row.id) ?? 0, asOf),
    }));
    const uoms = [...new Set(items.map((i) => i.uom))].sort();
    const rollup = (key: 'trade' | 'location') => {
      const m = new Map<
        string,
        { name: string | null; uom: string; planned: number; actual: number }
      >();
      for (const i of items) {
        const k = `${i[key] ?? ''}\u0000${i.uom}`;
        const g = m.get(k) ?? { name: i[key], uom: i.uom, planned: 0, actual: 0 };
        g.planned += i.plannedQuantity;
        g.actual += actualBy.get(i.id) ?? 0;
        m.set(k, g);
      }
      return [...m.values()]
        .map((g) => ({ ...g, planned: r2(g.planned), actual: r2(g.actual) }))
        .sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿') || a.uom.localeCompare(b.uom));
    };
    return {
      asOf,
      items: rowsOut,
      curves: uoms.map((uom) => ({
        uom,
        points: productionCurve(
          items.filter((i) => i.uom === uom),
          entries,
          asOf,
        ),
      })),
      byTrade: rollup('trade'),
      byLocation: rollup('location'),
      flags: rateFlags(items, entries, asOf),
    };
  }

  return { createItem, updateItem, logEntry, listEntries, report };
}

export type ProductionService = ReturnType<typeof createProductionService>;
