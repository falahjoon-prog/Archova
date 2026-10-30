import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { rateOn, scaled, type RatePoint } from '../domain/estimate';
import { costItems, costRates, type CostCategory } from '../infra/tables';

export type CostItemRow = typeof costItems.$inferSelect;
export type CostRateRow = typeof costRates.$inferSelect;
export interface CostItemView extends CostItemRow {
  /** The rate in force today (for the region asked about), or null when the item has none yet. */
  currentRate: RatePoint | null;
}

export interface RateInput {
  rate: string;
  region?: string | null;
  effectiveFrom?: string;
  source?: 'manual' | 'quote' | 'import';
  note?: string | null;
}

export interface CostItemFields {
  code?: string;
  description?: string;
  unit?: string;
  trade?: string;
  category?: CostCategory;
}

export interface LibraryDeps {
  now?: () => Date;
}

const rateProblem = (rate: string) => {
  if (scaled(rate, 2) === null)
    throw new AppError('cost_item.invalid', 'That rate is not a dollar amount.', [
      { path: 'rate', message: 'Use a number with up to two decimal places' },
    ]);
};

export function createLibraryService(deps: LibraryDeps = {}) {
  const now = () => (deps.now ?? (() => new Date()))();
  // The library is the company's, not a project's, so "today" is the AU east-coast date until orgs carry a zone.
  const today = () => localDateOf(now(), 'Australia/Sydney');

  async function load(scope: TenantScope, id: string) {
    const [row] = await scope.tx
      .select()
      .from(costItems)
      .where(and(eq(costItems.id, id), isNull(costItems.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('cost_item.not_found');
    return row;
  }

  async function ratesOf(scope: TenantScope, itemIds: readonly string[]) {
    if (itemIds.length === 0) return new Map<string, CostRateRow[]>();
    const rows = await scope.tx
      .select()
      .from(costRates)
      .where(inArray(costRates.costItemId, [...itemIds]));
    const byItem = new Map<string, CostRateRow[]>();
    for (const r of rows) byItem.set(r.costItemId, [...(byItem.get(r.costItemId) ?? []), r]);
    return byItem;
  }

  const point = (r: CostRateRow): RatePoint => ({
    rate: r.rate,
    region: r.region,
    effectiveFrom: r.effectiveFrom,
  });

  async function list(
    scope: TenantScope,
    opts: {
      q?: string;
      trade?: string;
      category?: CostCategory;
      region?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const after = decodeCursor<{ code: string; id: string }>(opts.cursor);
    const conditions = [isNull(costItems.deletedAt)];
    if (opts.trade) conditions.push(eq(costItems.trade, opts.trade));
    if (opts.category) conditions.push(eq(costItems.category, opts.category));
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(or(ilike(costItems.code, like), ilike(costItems.description, like))!);
    }
    if (after)
      conditions.push(
        sql`(lower(${costItems.code}), ${costItems.id}) > (${after.code.toLowerCase()}, ${after.id})`,
      );
    const rows = await scope.tx
      .select()
      .from(costItems)
      .where(and(...conditions))
      .orderBy(asc(sql`lower(${costItems.code})`), asc(costItems.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ code: r.code, id: r.id }));
    const rates = await ratesOf(
      scope,
      page.data.map((r) => r.id),
    );
    const views: CostItemView[] = page.data.map((r) => ({
      ...r,
      currentRate: rateOn((rates.get(r.id) ?? []).map(point), today(), opts.region ?? null),
    }));
    return { data: views, nextCursor: page.nextCursor };
  }

  async function view(scope: TenantScope, row: CostItemRow, region?: string | null) {
    const rates = await ratesOf(scope, [row.id]);
    return {
      ...row,
      currentRate: rateOn((rates.get(row.id) ?? []).map(point), today(), region ?? null),
    } satisfies CostItemView;
  }

  async function insertRate(scope: TenantScope, itemId: string, input: RateInput) {
    rateProblem(input.rate);
    await scope.tx.insert(costRates).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      costItemId: itemId,
      rate: input.rate,
      region: input.region?.trim() || null,
      effectiveFrom: input.effectiveFrom ?? today(),
      source: input.source ?? 'manual',
      note: input.note?.trim() || null,
      createdBy: scope.ctx.userId,
    });
  }

  async function assertCodeFree(scope: TenantScope, code: string, exceptId?: string) {
    const [clash] = await scope.tx
      .select({ id: costItems.id })
      .from(costItems)
      .where(
        and(sql`lower(${costItems.code}) = ${code.toLowerCase()}`, isNull(costItems.deletedAt)),
      )
      .limit(1);
    if (clash && clash.id !== exceptId)
      throw new AppError('cost_item.code_taken', 'Another item already uses that code.', [
        { path: 'code', message: 'Codes are unique in your library' },
      ]);
  }

  async function create(
    scope: TenantScope,
    input: Required<Pick<CostItemFields, 'code' | 'description' | 'unit'>> &
      CostItemFields & { rate?: RateInput },
  ) {
    const code = input.code.trim();
    await assertCodeFree(scope, code);
    const id = uuidv7();
    await scope.tx.insert(costItems).values({
      id,
      orgId: scope.ctx.orgId,
      code,
      description: input.description.trim(),
      unit: input.unit.trim(),
      trade: input.trade?.trim() ?? '',
      category: input.category ?? 'other',
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    if (input.rate) await insertRate(scope, id, input.rate);
    return view(scope, await load(scope, id), input.rate?.region);
  }

  async function get(scope: TenantScope, id: string, region?: string | null) {
    return view(scope, await load(scope, id), region);
  }

  async function update(scope: TenantScope, id: string, expected: number, patch: CostItemFields) {
    const row = await load(scope, id);
    if (row.version !== expected) throw versionConflict();
    if (patch.code !== undefined) await assertCodeFree(scope, patch.code.trim(), id);
    const [updated] = await scope.tx
      .update(costItems)
      .set({
        ...(patch.code !== undefined ? { code: patch.code.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit.trim() } : {}),
        ...(patch.trade !== undefined ? { trade: patch.trade.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(costItems.id, id), eq(costItems.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return view(scope, updated);
  }

  async function remove(scope: TenantScope, id: string) {
    const row = await load(scope, id);
    await scope.tx
      .update(costItems)
      .set({ deletedAt: now(), version: row.version + 1, updatedBy: scope.ctx.userId })
      .where(eq(costItems.id, id));
  }

  async function addRate(scope: TenantScope, id: string, input: RateInput) {
    await load(scope, id);
    await insertRate(scope, id, input);
    return listRates(scope, id);
  }

  async function listRates(scope: TenantScope, id: string) {
    await load(scope, id);
    return scope.tx
      .select()
      .from(costRates)
      .where(eq(costRates.costItemId, id))
      .orderBy(sql`${costRates.effectiveFrom} desc`, sql`${costRates.id} desc`);
  }

  /** Rates in force on a date for the given items, for pricing estimate lines. */
  async function ratesFor(
    scope: TenantScope,
    itemIds: readonly string[],
    onDate: string,
    region: string | null,
  ) {
    const rates = await ratesOf(scope, itemIds);
    return new Map(
      itemIds.map((id) => [id, rateOn((rates.get(id) ?? []).map(point), onDate, region)] as const),
    );
  }

  return { list, get, create, update, remove, addRate, listRates, ratesFor, load };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
