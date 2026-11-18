import { and, asc, eq, gt, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import { companyContacts } from '../infra/tables';
import type { CompanyService } from './companies';

/** Escapes LIKE wildcards so a search for "50%" matches the text. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createCompanyContactService(deps: { companies: CompanyService }) {
  async function list(
    scope: TenantScope,
    opts: {
      limit: number;
      cursor?: string | undefined;
      q?: string | undefined;
      companyId?: string | undefined;
    },
  ) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [isNull(companyContacts.deletedAt)];
    if (after) conditions.push(gt(companyContacts.id, after.id));
    if (opts.companyId) conditions.push(eq(companyContacts.companyId, opts.companyId));
    const q = opts.q?.trim();
    if (q) {
      const pattern = like(q);
      const match = or(
        ilike(companyContacts.name, pattern),
        ilike(companyContacts.email, pattern),
        ilike(companyContacts.phone, pattern),
        ilike(companyContacts.jobTitle, pattern),
      );
      if (match) conditions.push(match);
    }
    const rows = await scope.tx
      .select()
      .from(companyContacts)
      .where(and(...conditions))
      .orderBy(asc(companyContacts.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  type Fields = {
    name: string;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    jobTitle?: string | null | undefined;
    notes?: string | null | undefined;
  };
  const clean = (v: string | null | undefined) => v?.trim() || null;

  async function create(scope: TenantScope, input: Fields & { companyId: string }) {
    if (!(await deps.companies.exists(scope, input.companyId)))
      throw new AppError('company.not_found', 'Company not found in this org.');
    const [row] = await scope.tx
      .insert(companyContacts)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        companyId: input.companyId,
        name: input.name.trim(),
        email: clean(input.email),
        phone: clean(input.phone),
        jobTitle: clean(input.jobTitle),
        notes: clean(input.notes),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function load(scope: TenantScope, id: string) {
    const [row] = await scope.tx
      .select()
      .from(companyContacts)
      .where(and(eq(companyContacts.id, id), isNull(companyContacts.deletedAt)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('company_contact.not_found', 'Contact not found.');
    return row;
  }

  async function update(scope: TenantScope, id: string, input: Partial<Fields>) {
    const row = await load(scope, id);
    const pick = (v: string | null | undefined, current: string | null) =>
      v === undefined ? current : clean(v);
    const name = input.name === undefined ? row.name : input.name.trim();
    if (!name) throw new AppError('company_contact.name_required', 'A contact needs a name.');
    const [done] = await scope.tx
      .update(companyContacts)
      .set({
        name,
        email: pick(input.email, row.email),
        phone: pick(input.phone, row.phone),
        jobTitle: pick(input.jobTitle, row.jobTitle),
        notes: pick(input.notes, row.notes),
        version: row.version + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(companyContacts.id, id))
      .returning();
    return done!;
  }

  async function remove(scope: TenantScope, id: string) {
    const row = await load(scope, id);
    await scope.tx
      .update(companyContacts)
      .set({
        deletedAt: new Date(),
        version: row.version + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(companyContacts.id, id));
  }

  return { list, create, update, remove };
}

export type CompanyContactService = ReturnType<typeof createCompanyContactService>;
