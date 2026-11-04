import { and, asc, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { CreateCompanyRequest } from '@archova/contracts';
import { decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import { companies, projectMembers } from '../infra/tables';

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

  /**
   * Companies working on a project: those with an active member, plus the builder's own. Names only; used where
   * a worker without an account picks their company (design/08 B2).
   */
  async function onProject(scope: TenantScope, projectId: string) {
    const members = scope.tx
      .selectDistinct({ id: projectMembers.companyId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, 'active')));
    return scope.tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(
        and(
          isNull(companies.deletedAt),
          or(eq(companies.isOwnCompany, true), inArray(companies.id, members)),
        ),
      )
      .orderBy(asc(companies.name), asc(companies.id))
      .limit(500);
  }

  /**
   * The same companies with the trades they list, for Nova to suggest who a defect belongs to (F5). Kept apart from
   * `onProject`, which stays names-only for the worker sign-in screen.
   */
  async function onProjectWithTrades(scope: TenantScope, projectId: string) {
    const members = scope.tx
      .selectDistinct({ id: projectMembers.companyId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, 'active')));
    return scope.tx
      .select({ id: companies.id, name: companies.name, trades: companies.trades })
      .from(companies)
      .where(
        and(
          isNull(companies.deletedAt),
          or(eq(companies.isOwnCompany, true), inArray(companies.id, members)),
        ),
      )
      .orderBy(asc(companies.name), asc(companies.id))
      .limit(500);
  }

  async function exists(scope: TenantScope, companyId: string): Promise<boolean> {
    const [row] = await scope.tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  /** Name and ABN, for matching a company to a contact in an accounting system. */
  async function identity(
    scope: TenantScope,
    companyId: string,
  ): Promise<{ name: string; abn: string | null } | null> {
    const [row] = await scope.tx
      .select({ name: companies.name, abn: companies.abn })
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  return { list, create, exists, identity, onProject, onProjectWithTrades };
}

export type CompanyService = ReturnType<typeof createCompanyService>;
