import { and, asc, eq, gt, isNull, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { CreateCompanyRequest } from '@archova/contracts';
import { decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import { companies } from '../infra/tables';

export function createCompanyService() {
  async function list(scope: TenantScope, opts: { limit: number; cursor?: string }) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [isNull(companies.deletedAt)];
    if (after) conditions.push(gt(companies.id, after.id));
    const rows = await scope.tx
      .select()
      .from(companies)
      .where(and(...conditions))
      .orderBy(asc(companies.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function create(scope: TenantScope, input: CreateCompanyRequest) {
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(companies)
      .values({
        id,
        orgId: scope.ctx.orgId,
        name: input.name.trim(),
        abn: input.abn ?? null,
        type: input.type,
        trades: input.trades ?? [],
        email: input.email ?? null,
        phone: input.phone ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await scope.recordChange({
      module: 'platform',
      entityType: 'company',
      entityId: id,
      op: 'upsert',
      version: 1,
    });
    scope.events.add({
      type: 'platform.company.created.v1',
      entityType: 'company',
      entityId: id,
      entityVersion: 1,
      data: { companyId: id },
    });
    return row!;
  }

  async function exists(scope: TenantScope, companyId: string): Promise<boolean> {
    const [row] = await scope.tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  return { list, create, exists };
}

export type CompanyService = ReturnType<typeof createCompanyService>;
