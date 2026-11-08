import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import { addDays } from '@archova/time';
import {
  CARBON_SOURCES,
  DEFAULT_FACTORS,
  kgCo2e,
  SOURCE_SCOPE,
  type CarbonScope,
  type CarbonSource,
} from '../domain/carbon';
import { percentChange } from '../domain/waste';
import { carbonEntries } from '../infra/tables';
import { projectToday, type EnvironmentDeps } from './shared';

export type CarbonRow = typeof carbonEntries.$inferSelect;

export interface CarbonEntry extends Omit<CarbonRow, 'quantity' | 'factor' | 'kgCo2e'> {
  quantity: number;
  factor: number;
  kgCo2e: number;
}
const toEntry = (r: CarbonRow): CarbonEntry => ({
  ...r,
  quantity: Number(r.quantity),
  factor: Number(r.factor),
  kgCo2e: Number(r.kgCo2e),
});
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface CarbonInput {
  entryDate: string;
  source: CarbonSource;
  quantity: number;
  /** kg CO2-e per unit; the source's default when left out. */
  factor?: number;
  description?: string | null;
  note?: string | null;
}

export interface CarbonOverview {
  totalKg: number;
  byScope: Record<CarbonScope, number>;
  bySource: { source: CarbonSource; quantity: number; kg: number }[];
  /** The last six months, oldest first, empty months included. */
  monthly: { month: string; kg: number }[];
  last30Kg: number;
  previous30Kg: number;
  /** Percentage change of the last 30 days over the 30 before; null without a base. */
  changePercent: number | null;
}

export function createCarbonService(deps: EnvironmentDeps) {
  async function createEntry(scope: TenantScope, projectId: string, input: CarbonInput) {
    const today = await projectToday(deps, scope, projectId);
    if (input.entryDate > today)
      throw new AppError('validation_failed', 'An entry cannot be dated in the future.', [
        { path: 'entryDate', message: 'In the future' },
      ]);
    if (!(input.quantity > 0))
      throw new AppError('validation_failed', 'Enter a quantity above zero.', [
        { path: 'quantity', message: 'Must be above zero' },
      ]);
    const factor = input.factor ?? DEFAULT_FACTORS[input.source];
    if (!(factor >= 0))
      throw new AppError('validation_failed', 'The emission factor cannot be negative.', [
        { path: 'factor', message: 'Must be zero or more' },
      ]);
    const [r] = await scope.tx
      .insert(carbonEntries)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        entryDate: input.entryDate,
        source: input.source,
        scope: SOURCE_SCOPE[input.source],
        quantity: String(input.quantity),
        factor: String(factor),
        kgCo2e: String(kgCo2e(input.quantity, factor)),
        description: input.description?.trim() || null,
        note: input.note?.trim() || null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return toEntry(r!);
  }

  async function listEntries(
    scope: TenantScope,
    projectId: string,
    opts: { source?: CarbonSource; limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ d: string; id: string }>(opts.cursor);
    const where: SQL[] = [eq(carbonEntries.projectId, projectId), isNull(carbonEntries.deletedAt)];
    if (opts.source) where.push(eq(carbonEntries.source, opts.source));
    if (after)
      where.push(
        sql`(${carbonEntries.entryDate}, ${carbonEntries.id}) < (${after.d}::date, ${after.id}::uuid)`,
      );
    const rows = await scope.tx
      .select()
      .from(carbonEntries)
      .where(and(...where))
      .orderBy(desc(carbonEntries.entryDate), desc(carbonEntries.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ d: r.entryDate, id: r.id }));
    return { data: page.data.map(toEntry), nextCursor: page.nextCursor };
  }

  async function deleteEntry(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx
      .update(carbonEntries)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(carbonEntries.id, id),
          eq(carbonEntries.projectId, projectId),
          isNull(carbonEntries.deletedAt),
        ),
      )
      .returning({ id: carbonEntries.id });
    if (!r) throw new AppError('environment.carbon_entry_not_found');
  }

  const kgSum = sql<number>`coalesce(sum(${carbonEntries.kgCo2e}), 0)::float8`;

  async function overview(scope: TenantScope, projectId: string): Promise<CarbonOverview> {
    const today = await projectToday(deps, scope, projectId);
    const live = and(eq(carbonEntries.projectId, projectId), isNull(carbonEntries.deletedAt));
    const monthKey = sql<string>`to_char(${carbonEntries.entryDate}, 'YYYY-MM')`;
    const rows = await scope.tx
      .select({
        month: monthKey,
        source: carbonEntries.source,
        scope: carbonEntries.scope,
        quantity: sql<number>`coalesce(sum(${carbonEntries.quantity}), 0)::float8`,
        kg: kgSum,
      })
      .from(carbonEntries)
      .where(live)
      .groupBy(monthKey, carbonEntries.source, carbonEntries.scope);

    const byScope: Record<CarbonScope, number> = { 1: 0, 2: 0, 3: 0 };
    const bySource = new Map<CarbonSource, { quantity: number; kg: number }>();
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      byScope[r.scope] += r.kg;
      const s = bySource.get(r.source) ?? { quantity: 0, kg: 0 };
      s.quantity += r.quantity;
      s.kg += r.kg;
      bySource.set(r.source, s);
      byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.kg);
    }
    const [y, mo] = today.split('-').map(Number) as [number, number];
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, mo - 1 - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const windowKg = async (from: string, to: string) => {
      const [r] = await scope.tx
        .select({ kg: kgSum })
        .from(carbonEntries)
        .where(and(live, gte(carbonEntries.entryDate, from), lte(carbonEntries.entryDate, to)));
      return r?.kg ?? 0;
    };
    const last30Kg = await windowKg(addDays(today, -29), today);
    const previous30Kg = await windowKg(addDays(today, -59), addDays(today, -30));
    return {
      totalKg: round1(byScope[1] + byScope[2] + byScope[3]),
      byScope: { 1: round1(byScope[1]), 2: round1(byScope[2]), 3: round1(byScope[3]) },
      bySource: CARBON_SOURCES.filter((s) => bySource.has(s))
        .map((source) => ({
          source,
          quantity: round1(bySource.get(source)!.quantity),
          kg: round1(bySource.get(source)!.kg),
        }))
        .sort((a, b) => b.kg - a.kg),
      monthly: months.map((month) => ({ month, kg: round1(byMonth.get(month) ?? 0) })),
      last30Kg: round1(last30Kg),
      previous30Kg: round1(previous30Kg),
      changePercent: percentChange(last30Kg, previous30Kg),
    };
  }

  return { createEntry, listEntries, deleteEntry, overview };
}

export type CarbonService = ReturnType<typeof createCarbonService>;
