import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import { bidderLists } from '../infra/tables';

export type BidderListRow = typeof bidderLists.$inferSelect;

export interface BidderListFields {
  name?: string;
  trade?: string;
  companyIds?: string[];
}

export interface BiddersDeps {
  platform: Pick<PlatformApi, 'companyExists'>;
  now?: () => Date;
}

/** Reusable bidder lists (company level): named sets of companies an estimator invites together. */
export function createBiddersService(deps: BiddersDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  async function load(scope: TenantScope, id: string) {
    const [row] = await scope.tx
      .select()
      .from(bidderLists)
      .where(and(eq(bidderLists.id, id), isNull(bidderLists.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('bidder_list.not_found');
    return row;
  }

  async function assertNameFree(scope: TenantScope, name: string, exceptId?: string) {
    const rows = await scope.tx
      .select({ id: bidderLists.id })
      .from(bidderLists)
      .where(and(isNull(bidderLists.deletedAt), sql`lower(${bidderLists.name}) = lower(${name})`));
    if (rows.some((r) => r.id !== exceptId))
      throw new AppError('bidder_list.name_taken', 'A bidder list with that name already exists.');
  }

  async function checkCompanies(scope: TenantScope, ids: string[]) {
    for (const [i, id] of ids.entries())
      if (!(await deps.platform.companyExists(scope, id)))
        throw new AppError('bidder_list.invalid', 'Choose companies from your directory.', [
          { path: `companyIds/${i}`, message: 'Not a company in your directory' },
        ]);
  }

  const clean = (ids: string[]) => [...new Set(ids)];

  async function list(scope: TenantScope, opts: { trade?: string }) {
    const conditions = [isNull(bidderLists.deletedAt)];
    if (opts.trade) conditions.push(eq(bidderLists.trade, opts.trade));
    return scope.tx
      .select()
      .from(bidderLists)
      .where(and(...conditions))
      .orderBy(asc(bidderLists.name), asc(bidderLists.id))
      .limit(500);
  }

  async function create(
    scope: TenantScope,
    input: Required<Pick<BidderListFields, 'name'>> & BidderListFields,
  ) {
    const name = input.name.trim();
    if (!name) throw new AppError('bidder_list.invalid', 'Give the list a name.');
    await assertNameFree(scope, name);
    const companyIds = clean(input.companyIds ?? []);
    await checkCompanies(scope, companyIds);
    const id = uuidv7();
    await scope.tx.insert(bidderLists).values({
      id,
      orgId: scope.ctx.orgId,
      name,
      trade: input.trade?.trim() ?? '',
      companyIds,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return load(scope, id);
  }

  async function update(scope: TenantScope, id: string, expected: number, patch: BidderListFields) {
    const row = await load(scope, id);
    if (row.version !== expected) throw versionConflict();
    const name = patch.name?.trim();
    if (patch.name !== undefined) {
      if (!name) throw new AppError('bidder_list.invalid', 'Give the list a name.');
      await assertNameFree(scope, name, id);
    }
    const companyIds = patch.companyIds ? clean(patch.companyIds) : undefined;
    if (companyIds) await checkCompanies(scope, companyIds);
    const [updated] = await scope.tx
      .update(bidderLists)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(patch.trade !== undefined ? { trade: patch.trade.trim() } : {}),
        ...(companyIds ? { companyIds } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(bidderLists.id, id), eq(bidderLists.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return updated;
  }

  async function remove(scope: TenantScope, id: string) {
    const row = await load(scope, id);
    await scope.tx
      .update(bidderLists)
      .set({ deletedAt: now(), version: row.version + 1, updatedBy: scope.ctx.userId })
      .where(eq(bidderLists.id, id));
  }

  return { list, create, get: load, update, remove };
}

export type BiddersService = ReturnType<typeof createBiddersService>;
