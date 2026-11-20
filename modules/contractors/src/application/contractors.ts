import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ilike, inArray, lt } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import type {
  CompanyContractor,
  CompanyContractorPage,
  ContractorCompanyList,
  ContractorLink,
  ContractorLinkPage,
  ContractorProfile,
  ContractorProfileInput,
} from '@archova/contracts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { directory, links, profiles, type LinkStatus } from '../infra/tables';

/** Open (pending) requests one contractor may have at once, so Add cannot be used to spam companies. */
export const MAX_OPEN_REQUESTS = 50;
/** After a company rejects a contractor, the same contractor cannot ask that company again for this long. */
export const REJECT_COOLDOWN_DAYS = 30;
export const MAX_SEARCH_RESULTS = 10;
export const MIN_SEARCH_LENGTH = 3;
/** Company searches per contractor per minute (in process; the edge limit is the real backstop). */
export const SEARCH_PER_MINUTE = 20;

type LinkRow = typeof links.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toLink = (r: LinkRow): ContractorLink => ({
  id: encodeId('contractorLink', r.id),
  companyName: r.companyName,
  status: r.status,
  requestedAt: r.requestedAt.toISOString(),
  decidedAt: iso(r.decidedAt),
});

/** Escapes LIKE wildcards so a search for "100%" matches the text, not everything. */
export const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A transaction in the target company, for the one thing a contractor may write there: their own link row. */
function companyCtx(orgId: string, userId: string): TenantContext {
  return {
    orgId,
    userId,
    principalType: 'external',
    orgRole: null,
    entitlements: { plan: 'contractor', state: 'active', modules: [], limits: {} },
    requestId: randomUUID(),
  };
}

export interface ContractorService {
  getProfile(userId: string): Promise<ContractorProfile>;
  saveProfile(userId: string, input: ContractorProfileInput): Promise<ContractorProfile>;
  searchCompanies(userId: string, q: string): Promise<ContractorCompanyList>;
  listMyLinks(
    userId: string,
    o: {
      q?: string | undefined;
      status?: LinkStatus | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<ContractorLinkPage>;
  requestLink(userId: string, companyPublicId: string): Promise<ContractorLink>;
  removeMyLink(userId: string, linkPublicId: string): Promise<void>;
  listForCompany(
    scope: TenantScope,
    o: {
      q?: string | undefined;
      status?: LinkStatus | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<CompanyContractorPage>;
  decide(
    scope: TenantScope,
    linkPublicId: string,
    to: 'accepted' | 'rejected',
  ): Promise<CompanyContractor>;
  endForCompany(scope: TenantScope, linkPublicId: string): Promise<void>;
}

export function createContractorService(
  database: Database,
  now: () => Date = () => new Date(),
): ContractorService {
  const searchHits = new Map<string, number[]>();
  function limitSearch(userId: string) {
    const t = now().getTime();
    const recent = (searchHits.get(userId) ?? []).filter((h) => t - h < 60_000);
    if (recent.length >= SEARCH_PER_MINUTE) {
      searchHits.set(userId, recent);
      throw new AppError('rate_limited', 'Too many searches. Wait a moment and try again.');
    }
    recent.push(t);
    searchHits.set(userId, recent);
  }

  const readProfile = (userId: string) =>
    database.withGlobalTx('contractors', async (tx) => {
      const [p] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
      return p ?? null;
    });
  const toProfile = (p: typeof profiles.$inferSelect): ContractorProfile => ({
    displayName: p.displayName,
    profession: p.profession,
    phone: p.phone,
  });
  async function requireProfile(userId: string) {
    const p = await readProfile(userId);
    if (!p) throw new AppError('contractor.profile_required');
    return p;
  }

  return {
    async getProfile(userId) {
      const p = await readProfile(userId);
      if (!p) throw new AppError('contractor.no_profile');
      return toProfile(p);
    },

    async saveProfile(userId, input) {
      const values = {
        displayName: input.displayName.trim(),
        profession: input.profession.trim(),
        phone: input.phone?.trim() || null,
      };
      if (!values.displayName || !values.profession)
        throw new AppError('validation_failed', 'Name and profession are required.');
      return database.withGlobalTx('contractors', async (tx) => {
        const [row] = await tx
          .insert(profiles)
          .values({ userId, ...values })
          .onConflictDoUpdate({ target: profiles.userId, set: values })
          .returning();
        return toProfile(row!);
      });
    },

    async searchCompanies(userId, q) {
      await requireProfile(userId);
      const term = q.trim();
      if (term.length < MIN_SEARCH_LENGTH)
        throw new AppError('validation_failed', `Type at least ${MIN_SEARCH_LENGTH} characters.`);
      limitSearch(userId);
      const found = await database.withGlobalTx('contractors', (tx) =>
        tx
          .select()
          .from(directory)
          .where(and(eq(directory.listed, true), ilike(directory.name, `%${likeEscape(term)}%`)))
          .orderBy(directory.name)
          .limit(MAX_SEARCH_RESULTS),
      );
      const mine = found.length
        ? await database.withSelfTx(userId, (tx) =>
            tx
              .select({ orgId: links.orgId, status: links.status })
              .from(links)
              .where(
                and(
                  eq(links.contractorUserId, userId),
                  inArray(
                    links.orgId,
                    found.map((f) => f.companyId),
                  ),
                ),
              ),
          )
        : [];
      const status = new Map(mine.map((m) => [m.orgId, m.status]));
      return {
        data: found.map((f) => ({
          id: encodeId('org', f.companyId),
          name: f.name,
          abnLast3: f.abnLast3,
          linkStatus: status.get(f.companyId) ?? null,
        })),
      };
    },

    async listMyLinks(userId, o) {
      const cursor = o.cursor ? decodeId('contractorLink', o.cursor) : null;
      const rows = await database.withSelfTx(userId, (tx) =>
        tx
          .select()
          .from(links)
          .where(
            and(
              eq(links.contractorUserId, userId),
              o.status ? eq(links.status, o.status) : undefined,
              o.q?.trim() ? ilike(links.companyName, `%${likeEscape(o.q.trim())}%`) : undefined,
              cursor ? lt(links.id, cursor) : undefined,
            ),
          )
          .orderBy(desc(links.id))
          .limit(o.limit + 1),
      );
      const page = rows.slice(0, o.limit);
      return {
        data: page.map(toLink),
        nextCursor:
          rows.length > o.limit ? encodeId('contractorLink', page[page.length - 1]!.id) : null,
      };
    },

    async requestLink(userId, companyPublicId) {
      await requireProfile(userId);
      const orgId = decodeId('org', companyPublicId);
      if (!orgId) throw new AppError('org.not_found');
      const company = await database.withGlobalTx('contractors', async (tx) => {
        const [d] = await tx
          .select()
          .from(directory)
          .where(and(eq(directory.companyId, orgId), eq(directory.listed, true)));
        return d ?? null;
      });
      if (!company) throw new AppError('org.not_found');

      return database.withTenantTx(companyCtx(orgId, userId), async (scope) => {
        const mine = and(eq(links.orgId, orgId), eq(links.contractorUserId, userId));
        const [existing] = await scope.tx.select().from(links).where(mine);
        if (existing && (existing.status === 'requested' || existing.status === 'accepted'))
          return toLink(existing);
        if (
          existing?.status === 'rejected' &&
          existing.decidedAt &&
          now().getTime() - existing.decidedAt.getTime() < REJECT_COOLDOWN_DAYS * 86_400_000
        )
          throw new AppError('contractor_link.rejected_recently');

        const total = await database.withSelfTx(userId, async (tx) => {
          const [r] = await tx
            .select({ n: count() })
            .from(links)
            .where(and(eq(links.contractorUserId, userId), eq(links.status, 'requested')));
          return r?.n ?? 0;
        });
        if (total >= MAX_OPEN_REQUESTS) throw new AppError('contractor_link.too_many_requests');

        const fresh = {
          companyName: company.name,
          status: 'requested' as const,
          requestedAt: now(),
          decidedAt: null,
          decidedBy: null,
        };
        const [row] = existing
          ? await scope.tx.update(links).set(fresh).where(mine).returning()
          : await scope.tx
              .insert(links)
              .values({ id: uuidv7(), orgId, contractorUserId: userId, ...fresh })
              .returning();
        return toLink(row!);
      });
    },

    /** Cancels a pending request or ends an accepted link. Gone, rejected or ended links are left alone. */
    async removeMyLink(userId, linkPublicId) {
      const id = decodeId('contractorLink', linkPublicId);
      if (!id) return;
      const mine = await database.withSelfTx(userId, async (tx) => {
        const [r] = await tx
          .select({ orgId: links.orgId, status: links.status })
          .from(links)
          .where(and(eq(links.id, id), eq(links.contractorUserId, userId)));
        return r ?? null;
      });
      if (!mine) return;
      await database.withTenantTx(companyCtx(mine.orgId, userId), async (scope) => {
        const own = and(eq(links.id, id), eq(links.contractorUserId, userId));
        if (mine.status === 'requested')
          await scope.tx.delete(links).where(and(own, eq(links.status, 'requested')));
        else if (mine.status === 'accepted')
          await scope.tx
            .update(links)
            .set({ status: 'ended', decidedAt: now() })
            .where(and(own, eq(links.status, 'accepted')));
      });
    },

    async listForCompany(scope, o) {
      const orgId = scope.ctx.orgId;
      const cursor = o.cursor ? decodeId('contractorLink', o.cursor) : null;
      const term = o.q?.trim();
      const rows = await scope.tx
        .select({ link: links, profile: profiles })
        .from(links)
        .leftJoin(profiles, eq(profiles.userId, links.contractorUserId))
        .where(
          and(
            eq(links.orgId, orgId),
            o.status ? eq(links.status, o.status) : undefined,
            term ? ilike(profiles.displayName, `%${likeEscape(term)}%`) : undefined,
            cursor ? lt(links.id, cursor) : undefined,
          ),
        )
        .orderBy(desc(links.id))
        .limit(o.limit + 1);
      const [{ n } = { n: 0 }] = await scope.tx
        .select({ n: count() })
        .from(links)
        .where(and(eq(links.orgId, orgId), eq(links.status, 'requested')));
      const page = rows.slice(0, o.limit);
      return {
        data: page.map((r) => toCompanyContractor(r.link, r.profile)),
        nextCursor:
          rows.length > o.limit ? encodeId('contractorLink', page[page.length - 1]!.link.id) : null,
        pendingCount: n,
      };
    },

    async decide(scope, linkPublicId, to) {
      const id = decodeId('contractorLink', linkPublicId);
      if (!id) throw new AppError('contractor_link.not_found');
      const where = and(eq(links.id, id), eq(links.orgId, scope.ctx.orgId));
      const [row] = await scope.tx.select().from(links).where(where);
      if (!row) throw new AppError('contractor_link.not_found');
      if (row.status === to) return withProfile(scope, row);
      if (row.status !== 'requested')
        throw new AppError('conflict', 'This request has already been decided.');
      const [updated] = await scope.tx
        .update(links)
        .set({ status: to, decidedAt: now(), decidedBy: scope.ctx.userId })
        .where(and(where, eq(links.status, 'requested')))
        .returning();
      return withProfile(scope, updated!);
    },

    async endForCompany(scope, linkPublicId) {
      const id = decodeId('contractorLink', linkPublicId);
      if (!id) return;
      await scope.tx
        .update(links)
        .set({ status: 'ended', decidedAt: now(), decidedBy: scope.ctx.userId })
        .where(
          and(eq(links.id, id), eq(links.orgId, scope.ctx.orgId), eq(links.status, 'accepted')),
        );
    },
  };

  async function withProfile(scope: TenantScope, row: LinkRow) {
    const [p] = await scope.tx
      .select()
      .from(profiles)
      .where(eq(profiles.userId, row.contractorUserId));
    return toCompanyContractor(row, p ?? null);
  }
}

/** The company sees the name and profession to decide; the phone only once the link is accepted. */
function toCompanyContractor(
  r: LinkRow,
  p: typeof profiles.$inferSelect | null,
): CompanyContractor {
  return {
    id: encodeId('contractorLink', r.id),
    displayName: p?.displayName ?? 'Deleted contractor',
    profession: p?.profession ?? '',
    phone: r.status === 'accepted' ? (p?.phone ?? null) : null,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: iso(r.decidedAt),
  };
}
