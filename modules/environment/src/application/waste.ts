import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import { addDays } from '@archova/time';
import {
  diversionPercent,
  isDiverted,
  REGULATED_TYPES,
  WASTE_DESTINATIONS,
  type WasteDestination,
  type WasteType,
} from '../domain/waste';
import { wasteDockets } from '../infra/tables';
import { checkFiles, projectToday, type EnvironmentDeps } from './shared';

export type DocketRow = typeof wasteDockets.$inferSelect;

/** A docket with its weight as a JS number (Postgres `numeric` comes back as a string). */
export interface Docket extends Omit<DocketRow, 'tonnes'> {
  tonnes: number;
}
const toDocket = (r: DocketRow): Docket => ({ ...r, tonnes: Number(r.tonnes) });
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface DocketInput {
  docketDate: string;
  wasteType: WasteType;
  destination: WasteDestination;
  tonnes: number;
  docketNumber?: string | null;
  contractor?: string | null;
  facility?: string | null;
  note?: string | null;
  fileIds?: string[];
}

interface Window {
  tonnes: number;
  divertedTonnes: number;
  diversionPercent: number | null;
}

export interface WasteOverview {
  totalTonnes: number;
  divertedTonnes: number;
  diversionPercent: number | null;
  byDestination: Record<WasteDestination, number>;
  byType: { wasteType: WasteType; tonnes: number; divertedTonnes: number }[];
  /** The last six months, oldest first, empty months included. */
  monthly: {
    month: string;
    tonnes: number;
    divertedTonnes: number;
    diversionPercent: number | null;
  }[];
  last30: Window;
  previous30: Window;
  /** Hazardous or asbestos dockets with no copy of the docket attached. */
  regulatedWithoutDocket: number;
}

export function createWasteService(deps: EnvironmentDeps) {
  async function createDocket(scope: TenantScope, projectId: string, input: DocketInput) {
    const today = await projectToday(deps, scope, projectId);
    if (input.docketDate > today)
      throw new AppError('validation_failed', 'A docket cannot be dated in the future.', [
        { path: 'docketDate', message: 'In the future' },
      ]);
    if (!(input.tonnes > 0) || input.tonnes > 100000)
      throw new AppError('validation_failed', 'Enter the weight in tonnes.', [
        { path: 'tonnes', message: 'Must be above zero' },
      ]);
    await checkFiles(deps, scope, projectId, input.fileIds ?? []);
    const [r] = await scope.tx
      .insert(wasteDockets)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        docketDate: input.docketDate,
        wasteType: input.wasteType,
        destination: input.destination,
        tonnes: String(round3(input.tonnes)),
        docketNumber: input.docketNumber?.trim() || null,
        contractor: input.contractor?.trim() || null,
        facility: input.facility?.trim() || null,
        note: input.note?.trim() || null,
        fileIds: [...new Set(input.fileIds ?? [])],
        createdBy: scope.ctx.userId,
      })
      .returning();
    return toDocket(r!);
  }

  async function listDockets(
    scope: TenantScope,
    projectId: string,
    opts: { wasteType?: WasteType; destination?: WasteDestination; limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ d: string; id: string }>(opts.cursor);
    const where: SQL[] = [eq(wasteDockets.projectId, projectId), isNull(wasteDockets.deletedAt)];
    if (opts.wasteType) where.push(eq(wasteDockets.wasteType, opts.wasteType));
    if (opts.destination) where.push(eq(wasteDockets.destination, opts.destination));
    if (after)
      where.push(
        sql`(${wasteDockets.docketDate}, ${wasteDockets.id}) < (${after.d}::date, ${after.id}::uuid)`,
      );
    const rows = await scope.tx
      .select()
      .from(wasteDockets)
      .where(and(...where))
      .orderBy(desc(wasteDockets.docketDate), desc(wasteDockets.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ d: r.docketDate, id: r.id }));
    return { data: page.data.map(toDocket), nextCursor: page.nextCursor };
  }

  async function deleteDocket(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx
      .update(wasteDockets)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(wasteDockets.id, id),
          eq(wasteDockets.projectId, projectId),
          isNull(wasteDockets.deletedAt),
        ),
      )
      .returning({ id: wasteDockets.id });
    if (!r) throw new AppError('environment.docket_not_found');
  }

  const tonnesSum = sql<number>`coalesce(sum(${wasteDockets.tonnes}), 0)::float8`;

  async function overview(scope: TenantScope, projectId: string): Promise<WasteOverview> {
    const today = await projectToday(deps, scope, projectId);
    const live = and(eq(wasteDockets.projectId, projectId), isNull(wasteDockets.deletedAt));
    const monthKey = sql<string>`to_char(${wasteDockets.docketDate}, 'YYYY-MM')`;
    const all = await scope.tx
      .select({
        month: monthKey,
        wasteType: wasteDockets.wasteType,
        destination: wasteDockets.destination,
        tonnes: tonnesSum,
      })
      .from(wasteDockets)
      .where(live)
      .groupBy(monthKey, wasteDockets.wasteType, wasteDockets.destination);

    const byDestination = Object.fromEntries(WASTE_DESTINATIONS.map((d) => [d, 0])) as Record<
      WasteDestination,
      number
    >;
    const byType = new Map<WasteType, { tonnes: number; divertedTonnes: number }>();
    const byMonth = new Map<string, { tonnes: number; divertedTonnes: number }>();
    for (const r of all) {
      byDestination[r.destination] += r.tonnes;
      const t = byType.get(r.wasteType) ?? { tonnes: 0, divertedTonnes: 0 };
      t.tonnes += r.tonnes;
      const m = byMonth.get(r.month) ?? { tonnes: 0, divertedTonnes: 0 };
      m.tonnes += r.tonnes;
      if (isDiverted(r.destination)) {
        t.divertedTonnes += r.tonnes;
        m.divertedTonnes += r.tonnes;
      }
      byType.set(r.wasteType, t);
      byMonth.set(r.month, m);
    }
    const totalTonnes = Object.values(byDestination).reduce((a, b) => a + b, 0);
    const divertedTonnes = byDestination.recycled + byDestination.reused;

    const months: string[] = [];
    const [y, mo] = today.split('-').map(Number) as [number, number];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, mo - 1 - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    const windowOf = async (from: string, to: string): Promise<Window> => {
      const rows = await scope.tx
        .select({ destination: wasteDockets.destination, tonnes: tonnesSum })
        .from(wasteDockets)
        .where(and(live, gte(wasteDockets.docketDate, from), lte(wasteDockets.docketDate, to)))
        .groupBy(wasteDockets.destination);
      const tonnes = rows.reduce((a, r) => a + r.tonnes, 0);
      const diverted = rows
        .filter((r) => isDiverted(r.destination))
        .reduce((a, r) => a + r.tonnes, 0);
      return {
        tonnes: round3(tonnes),
        divertedTonnes: round3(diverted),
        diversionPercent: diversionPercent(diverted, tonnes),
      };
    };

    const [{ n }] = (await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(wasteDockets)
      .where(
        and(
          live,
          sql`${wasteDockets.wasteType} in (${sql.join(
            REGULATED_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )})`,
          sql`cardinality(${wasteDockets.fileIds}) = 0`,
        ),
      )) as [{ n: number }];

    return {
      totalTonnes: round3(totalTonnes),
      divertedTonnes: round3(divertedTonnes),
      diversionPercent: diversionPercent(divertedTonnes, totalTonnes),
      byDestination: Object.fromEntries(
        Object.entries(byDestination).map(([k, v]) => [k, round3(v)]),
      ) as Record<WasteDestination, number>,
      byType: [...byType.entries()]
        .map(([wasteType, v]) => ({
          wasteType,
          tonnes: round3(v.tonnes),
          divertedTonnes: round3(v.divertedTonnes),
        }))
        .sort((a, b) => b.tonnes - a.tonnes),
      monthly: months.map((month) => {
        const v = byMonth.get(month) ?? { tonnes: 0, divertedTonnes: 0 };
        return {
          month,
          tonnes: round3(v.tonnes),
          divertedTonnes: round3(v.divertedTonnes),
          diversionPercent: diversionPercent(v.divertedTonnes, v.tonnes),
        };
      }),
      last30: await windowOf(addDays(today, -29), today),
      previous30: await windowOf(addDays(today, -59), addDays(today, -30)),
      regulatedWithoutDocket: n,
    };
  }

  return { createDocket, listDockets, deleteDocket, overview };
}

export type WasteService = ReturnType<typeof createWasteService>;
