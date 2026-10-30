import { and, asc, desc, eq, inArray, isNull, lt, max } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import {
  computeSheet,
  scaled,
  sumQuantities,
  type SheetSettings,
  type SheetTotals,
} from '../domain/estimate';
import {
  costItems,
  estimateLines,
  estimates,
  takeoffMeasurements,
  type MarginBasis,
} from '../infra/tables';
import type { LibraryService } from './library';

export type EstimateRow = typeof estimates.$inferSelect;
export type LineRow = typeof estimateLines.$inferSelect;

export interface EstimateDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  library: LibraryService;
  now?: () => Date;
}

export interface EstimateFields {
  name?: string;
  baseDate?: string;
  region?: string | null;
  contingencyPct?: string;
  marginPct?: string;
  marginBasis?: MarginBasis;
  gstPct?: string;
}

export interface LineInput {
  kind?: 'section' | 'item';
  parentId?: string | null;
  description?: string;
  costItemId?: string | null;
  quantity?: string | null;
  unit?: string | null;
  rate?: string | null;
  /** Takeoff this line is priced from. Its quantity is whatever is confirmed on these measurements. */
  measurementIds?: string[];
}

export interface LineView extends LineRow {
  /** Quantity × rate, ex GST; null while the quantity or rate is missing. */
  amount: string | null;
  /** Linked measurements not yet accepted by a person; they add nothing to the quantity. */
  pendingMeasurements: number;
  /** The library item prices in a different unit from this line's quantity. */
  unitMismatch: boolean;
}

export interface EstimateView {
  estimate: EstimateRow;
  lines: LineView[];
  totals: SheetTotals;
}

const invalid = (path: string, message: string) =>
  new AppError('estimate.invalid', 'This estimate does not add up.', [{ path, message }]);

const settingsOf = (e: EstimateRow): SheetSettings => ({
  contingencyPct: e.contingencyPct,
  marginPct: e.marginPct,
  marginBasis: e.marginBasis,
  gstPct: e.gstPct,
});

export function createEstimateService(deps: EstimateDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  async function load(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(estimates)
      .where(
        and(eq(estimates.id, id), eq(estimates.projectId, projectId), isNull(estimates.deletedAt)),
      )
      .limit(1);
    if (!row) throw new AppError('estimate.not_found');
    return row;
  }

  const editable = (e: EstimateRow) => {
    if (e.status === 'issued')
      throw new AppError('estimate.locked', 'This estimate is issued and cannot be changed.');
  };

  function checkPercents(f: EstimateFields) {
    for (const [path, v, hi] of [
      ['contingencyPct', f.contingencyPct, 100],
      ['marginPct', f.marginPct, 99.99],
      ['gstPct', f.gstPct, 100],
    ] as const) {
      if (v === undefined) continue;
      const n = scaled(v, 2);
      if (n === null || n > BigInt(Math.round(hi * 100)))
        throw invalid(path, `Enter a percentage from 0 to ${hi}`);
    }
  }

  async function touch(scope: TenantScope, e: EstimateRow) {
    await scope.tx
      .update(estimates)
      .set({ version: e.version + 1, updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(eq(estimates.id, e.id));
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ number: number }>(opts.cursor);
    const conditions = [eq(estimates.projectId, projectId), isNull(estimates.deletedAt)];
    if (after) conditions.push(lt(estimates.number, after.number));
    const rows = await scope.tx
      .select()
      .from(estimates)
      .where(and(...conditions))
      .orderBy(desc(estimates.number))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ number: r.number }));
  }

  /** The measurements behind takeoff lines, keyed by id, with whether each currently counts. */
  async function measurementState(scope: TenantScope, lines: readonly LineRow[]) {
    const ids = [...new Set(lines.flatMap((l) => l.measurementIds))];
    const state = new Map<string, { quantity: string; unit: string; counts: boolean }>();
    if (ids.length === 0) return state;
    const rows = await scope.tx
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.id, ids));
    for (const m of rows)
      state.set(m.id, {
        quantity: m.quantity,
        unit: m.unit,
        counts: !m.deletedAt && !!m.confirmedAt && !m.rejectedAt,
      });
    return state;
  }

  /** A takeoff line's quantity is what is confirmed on its measurements right now; other lines keep their own. */
  function liveQuantity(line: LineRow, state: Awaited<ReturnType<typeof measurementState>>) {
    if (line.measurementIds.length === 0) return { quantity: line.quantity, pending: 0 };
    const counted = line.measurementIds.flatMap((id) => {
      const m = state.get(id);
      return m?.counts ? [m.quantity] : [];
    });
    return {
      quantity: counted.length > 0 ? sumQuantities(counted) : null,
      pending: line.measurementIds.length - counted.length,
    };
  }

  async function build(scope: TenantScope, e: EstimateRow): Promise<EstimateView> {
    const rows = await scope.tx
      .select()
      .from(estimateLines)
      .where(eq(estimateLines.estimateId, e.id))
      .orderBy(asc(estimateLines.sort), asc(estimateLines.id));
    // An issued estimate is frozen at what was stored; a draft follows the takeoff.
    const state = e.status === 'issued' ? new Map() : await measurementState(scope, rows);
    const itemIds = [...new Set(rows.flatMap((r) => (r.costItemId ? [r.costItemId] : [])))];
    const units = new Map<string, string>();
    if (itemIds.length > 0)
      for (const c of await scope.tx
        .select({ id: costItems.id, unit: costItems.unit })
        .from(costItems)
        .where(inArray(costItems.id, itemIds)))
        units.set(c.id, c.unit);
    const live = rows.map((r) => ({
      row: r,
      ...(e.status === 'issued' ? { quantity: r.quantity, pending: 0 } : liveQuantity(r, state)),
    }));
    const totals = computeSheet(
      live.map((l) => ({
        id: l.row.id,
        parentId: l.row.parentId,
        kind: l.row.kind,
        quantity: l.quantity,
        rate: l.row.rate,
      })),
      settingsOf(e),
    );
    const lines: LineView[] = live.map((l) => ({
      ...l.row,
      quantity: l.quantity,
      amount: totals.amounts[l.row.id] ?? null,
      pendingMeasurements: l.pending,
      unitMismatch:
        l.row.kind === 'item' &&
        !!l.row.costItemId &&
        !!l.row.unit &&
        units.get(l.row.costItemId) !== l.row.unit,
    }));
    return { estimate: e, lines, totals };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: EstimateFields & { name: string },
  ) {
    const project = await deps.platform.getProject(scope, projectId);
    checkPercents(input);
    const id = uuidv7();
    await scope.tx.insert(estimates).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number: await nextNumber(scope, projectId, 'estimate'),
      name: input.name.trim(),
      baseDate: input.baseDate ?? localDateOf(now(), project.timezone),
      region: input.region?.trim() || null,
      ...(input.contingencyPct !== undefined ? { contingencyPct: input.contingencyPct } : {}),
      ...(input.marginPct !== undefined ? { marginPct: input.marginPct } : {}),
      ...(input.marginBasis !== undefined ? { marginBasis: input.marginBasis } : {}),
      ...(input.gstPct !== undefined ? { gstPct: input.gstPct } : {}),
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return build(scope, await load(scope, projectId, id));
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    return build(scope, await load(scope, projectId, id));
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    patch: EstimateFields,
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expected) throw versionConflict();
    editable(row);
    checkPercents(patch);
    const [updated] = await scope.tx
      .update(estimates)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.baseDate !== undefined ? { baseDate: patch.baseDate } : {}),
        ...(patch.region !== undefined ? { region: patch.region?.trim() || null } : {}),
        ...(patch.contingencyPct !== undefined ? { contingencyPct: patch.contingencyPct } : {}),
        ...(patch.marginPct !== undefined ? { marginPct: patch.marginPct } : {}),
        ...(patch.marginBasis !== undefined ? { marginBasis: patch.marginBasis } : {}),
        ...(patch.gstPct !== undefined ? { gstPct: patch.gstPct } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(estimates.id, id), eq(estimates.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return build(scope, updated);
  }

  async function remove(scope: TenantScope, projectId: string, id: string) {
    const row = await load(scope, projectId, id);
    editable(row);
    await scope.tx
      .update(estimates)
      .set({ deletedAt: now(), version: row.version + 1, updatedBy: scope.ctx.userId })
      .where(eq(estimates.id, id));
  }

  async function loadLine(scope: TenantScope, estimateId: string, lineId: string) {
    const [line] = await scope.tx
      .select()
      .from(estimateLines)
      .where(and(eq(estimateLines.id, lineId), eq(estimateLines.estimateId, estimateId)))
      .limit(1);
    if (!line) throw new AppError('estimate.line_not_found');
    return line;
  }

  /** Linked measurements must be on this project, and share one unit, so their sum means something. */
  async function takeoffFor(scope: TenantScope, projectId: string, ids: readonly string[]) {
    const rows = await scope.tx
      .select()
      .from(takeoffMeasurements)
      .where(
        and(
          inArray(takeoffMeasurements.id, [...ids]),
          eq(takeoffMeasurements.projectId, projectId),
          isNull(takeoffMeasurements.deletedAt),
        ),
      );
    if (rows.length !== new Set(ids).size)
      throw invalid('measurementIds', 'Not every measurement is on this project');
    const units = new Set(rows.map((r) => r.unit));
    if (units.size > 1)
      throw invalid('measurementIds', 'These measurements use different units; price them apart');
    const counted = rows.filter((r) => r.confirmedAt && !r.rejectedAt).map((r) => r.quantity);
    return { unit: rows[0]!.unit, quantity: counted.length ? sumQuantities(counted) : null };
  }

  async function addLine(
    scope: TenantScope,
    projectId: string,
    estimateId: string,
    input: LineInput,
  ) {
    const e = await load(scope, projectId, estimateId);
    editable(e);
    const id = uuidv7();
    const kind = input.kind ?? 'item';
    const [{ top } = { top: null }] = await scope.tx
      .select({ top: max(estimateLines.sort) })
      .from(estimateLines)
      .where(eq(estimateLines.estimateId, estimateId));
    const sort = (top ?? 0) + 1;
    if (kind === 'section') {
      if (!input.description?.trim()) throw invalid('description', 'A section needs a name');
      await scope.tx.insert(estimateLines).values({
        id,
        orgId: scope.ctx.orgId,
        estimateId,
        kind,
        sort,
        description: input.description.trim(),
        updatedBy: scope.ctx.userId,
      });
    } else {
      const fields = await resolveItem(scope, projectId, e, estimateId, input, null);
      await scope.tx.insert(estimateLines).values({
        id,
        orgId: scope.ctx.orgId,
        estimateId,
        kind,
        sort,
        updatedBy: scope.ctx.userId,
        ...fields,
      });
    }
    await touch(scope, e);
    return build(scope, await load(scope, projectId, estimateId));
  }

  /** Works out an item's stored fields from the request and, for a patch, the line as it stands. */
  async function resolveItem(
    scope: TenantScope,
    projectId: string,
    e: EstimateRow,
    estimateId: string,
    input: LineInput,
    current: LineRow | null,
  ) {
    const parentId = input.parentId !== undefined ? input.parentId : (current?.parentId ?? null);
    if (parentId) {
      const parent = await loadLine(scope, estimateId, parentId);
      if (parent.kind !== 'section') throw invalid('parentId', 'Items go under a section');
    }
    const costItemId =
      input.costItemId !== undefined ? input.costItemId : (current?.costItemId ?? null);
    const item = costItemId ? await deps.library.load(scope, costItemId) : null;
    const measurementIds =
      input.measurementIds !== undefined ? input.measurementIds : (current?.measurementIds ?? []);
    let quantity = input.quantity !== undefined ? input.quantity : (current?.quantity ?? null);
    let unit = input.unit !== undefined ? input.unit : (current?.unit ?? null);
    if (measurementIds.length > 0) {
      if (input.quantity !== undefined && input.quantity !== null)
        throw invalid('quantity', 'The quantity comes from the takeoff; detach it to type one');
      const t = await takeoffFor(scope, projectId, measurementIds);
      quantity = t.quantity;
      unit = t.unit;
    } else if (!unit && item) unit = item.unit;
    if (quantity !== null && scaled(quantity, 3) === null)
      throw invalid('quantity', 'Enter a number with up to three decimal places');
    if (input.rate !== undefined && input.rate !== null && scaled(input.rate, 2) === null)
      throw invalid('rate', 'Enter a dollar amount with up to two decimal places');
    // A rate typed by the estimator always stands. Otherwise a newly chosen library item brings its current rate,
    // and if it has none the line stays unpriced and flagged: a rate is never invented.
    let rate = input.rate !== undefined ? input.rate : (current?.rate ?? null);
    if (input.rate === undefined && item && item.id !== current?.costItemId) {
      const found = (await deps.library.ratesFor(scope, [item.id], e.baseDate, e.region)).get(
        item.id,
      );
      rate = found?.rate ?? null;
    }
    const description = (
      input.description ??
      current?.description ??
      item?.description ??
      ''
    ).trim();
    if (!description) throw invalid('description', 'Describe what is being priced');
    return { parentId, costItemId, measurementIds, quantity, unit, rate, description };
  }

  async function updateLine(
    scope: TenantScope,
    projectId: string,
    estimateId: string,
    lineId: string,
    patch: LineInput,
  ) {
    const e = await load(scope, projectId, estimateId);
    editable(e);
    const line = await loadLine(scope, estimateId, lineId);
    const set =
      line.kind === 'section'
        ? { description: (patch.description ?? line.description).trim() }
        : await resolveItem(scope, projectId, e, estimateId, patch, line);
    if (line.kind === 'section' && !set.description)
      throw invalid('description', 'A section needs a name');
    await scope.tx
      .update(estimateLines)
      .set({ ...set, updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(eq(estimateLines.id, lineId));
    await touch(scope, e);
    return build(scope, await load(scope, projectId, estimateId));
  }

  async function removeLine(
    scope: TenantScope,
    projectId: string,
    estimateId: string,
    lineId: string,
  ) {
    const e = await load(scope, projectId, estimateId);
    editable(e);
    const line = await loadLine(scope, estimateId, lineId);
    // A section takes its items with it.
    await scope.tx
      .delete(estimateLines)
      .where(and(eq(estimateLines.estimateId, estimateId), eq(estimateLines.parentId, line.id)));
    await scope.tx.delete(estimateLines).where(eq(estimateLines.id, lineId));
    await touch(scope, e);
    return build(scope, await load(scope, projectId, estimateId));
  }

  /**
   * Freezes the sheet. Every item needs a quantity and a rate first: an issued total that quietly leaves lines out
   * would be worse than none.
   */
  async function issue(scope: TenantScope, projectId: string, id: string, expected: number) {
    const e = await load(scope, projectId, id);
    if (e.version !== expected) throw versionConflict();
    editable(e);
    const sheet = await build(scope, e);
    const items = sheet.lines.filter((l) => l.kind === 'item');
    if (items.length === 0) throw invalid('lines', 'Add at least one priced line before issuing');
    const unpriced = items.filter((l) => l.amount === null);
    if (unpriced.length > 0)
      throw new AppError(
        'estimate.rates_missing',
        `${unpriced.length} line${unpriced.length === 1 ? ' has' : 's have'} no quantity or rate yet.`,
        unpriced.map((l) => ({ path: `lines/${l.id}`, message: 'Needs a quantity and a rate' })),
      );
    for (const l of items.filter((x) => x.measurementIds.length > 0))
      await scope.tx
        .update(estimateLines)
        .set({ quantity: l.quantity })
        .where(eq(estimateLines.id, l.id));
    const [updated] = await scope.tx
      .update(estimates)
      .set({
        status: 'issued',
        issuedAt: now(),
        issuedBy: scope.ctx.userId,
        totalExGst: sheet.totals.totalExGst,
        version: e.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(estimates.id, id), eq(estimates.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    scope.events.add({
      type: 'estimating.estimate.issued.v1',
      projectId,
      entityType: 'estimate',
      entityId: id,
      entityVersion: updated.version,
      data: { estimateId: id, totalExGst: sheet.totals.totalExGst },
    });
    return build(scope, updated);
  }

  return { list, get, create, update, remove, addLine, updateLine, removeLine, issue };
}

export type EstimateService = ReturnType<typeof createEstimateService>;
