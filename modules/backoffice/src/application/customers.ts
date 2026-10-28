import { and, asc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import type { OrgListItemDto, Page } from '@archova/contracts';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import { tenantDirectory } from '../infra/tables';

export interface DirectoryEntry {
  id: string;
  name: string;
  slug: string;
  planCode: string;
  state: string;
  seats?: number | null;
  trialEndsAt?: Date | null;
}

const dto = (r: typeof tenantDirectory.$inferSelect): OrgListItemDto => ({
  orgId: encodeId('org', r.id),
  name: r.name,
  slug: r.slug,
  plan: r.planCode,
  state: r.state,
  seats: r.seats,
  trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

const enc = (name: string, id: string) => Buffer.from(`${name}\u0000${id}`).toString('base64url');
const dec = (cursor: string): [string, string] | null => {
  const [name, id] = Buffer.from(cursor, 'base64url').toString().split('\u0000');
  return name !== undefined && id ? [name, id] : null;
};

/** The tenant directory (backend 09 §3): customer companies for the console, with no tenant-table queries. */
export function createCustomerService({ database }: Pick<KernelServices, 'database'>) {
  /** Called by `platform` inside the org's own transaction, so the directory never lags the org. */
  async function upsert(tx: Tx, e: DirectoryEntry) {
    await tx
      .insert(tenantDirectory)
      .values({
        id: e.id,
        name: e.name,
        slug: e.slug,
        planCode: e.planCode,
        state: e.state,
        seats: e.seats ?? null,
        trialEndsAt: e.trialEndsAt ?? null,
      })
      .onConflictDoUpdate({
        target: tenantDirectory.id,
        set: {
          name: e.name,
          slug: e.slug,
          planCode: e.planCode,
          state: e.state,
          seats: e.seats ?? null,
          trialEndsAt: e.trialEndsAt ?? null,
          updatedAt: sql`now()`,
        },
      });
  }

  async function list(q: {
    q?: string;
    cursor?: string;
    limit: number;
  }): Promise<Page<OrgListItemDto>> {
    const after = q.cursor ? dec(q.cursor) : null;
    if (q.cursor && !after)
      throw new AppError('validation_failed', 'Invalid cursor', [
        { path: 'cursor', message: 'Invalid cursor' },
      ]);
    const term = q.q?.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await database.withGlobalTx('backoffice', (t) =>
      t
        .select()
        .from(tenantDirectory)
        .where(
          and(
            term
              ? or(
                  ilike(tenantDirectory.name, `%${term}%`),
                  ilike(tenantDirectory.slug, `%${term}%`),
                )
              : undefined,
            after
              ? or(
                  gt(tenantDirectory.name, after[0]),
                  and(eq(tenantDirectory.name, after[0]), gt(tenantDirectory.id, after[1])),
                )
              : undefined,
          ),
        )
        .orderBy(asc(tenantDirectory.name), asc(tenantDirectory.id))
        .limit(q.limit + 1),
    );
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(dto),
      nextCursor: rows.length > q.limit && last ? enc(last.name, last.id) : null,
    };
  }

  async function get(id: string): Promise<OrgListItemDto> {
    const [row] = await database.withGlobalTx('backoffice', (t) =>
      t.select().from(tenantDirectory).where(eq(tenantDirectory.id, id)),
    );
    if (!row) throw new AppError('org.not_found');
    return dto(row);
  }

  return { upsert, list, get };
}

export type CustomerService = ReturnType<typeof createCustomerService>;
