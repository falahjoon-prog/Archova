import { and, count, desc, eq, ilike, lt, sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import type {
  CompanyContractor,
  CompanyContractorPage,
  ContractorCompanyList,
  ContractorLink,
  ContractorLinkPage,
  ContractorListing,
  ContractorProfile,
  ContractorProfileInput,
} from '@archova/contracts';
import { AppError, type Database, type TenantScope } from '@archova/kernel';
import { createLinksRepo, type SelfLink } from '../infra/links-repo';
import { directory, linkDecisions, links, profiles, type LinkStatus } from '../infra/tables';
import type { createSearchGuard } from './search-guard';

/** Open (pending) requests one contractor may have at once, across companies. */
export const MAX_OPEN_REQUESTS = 50;
/** Open (pending) requests one company may have waiting, so bulk accounts cannot flood one builder. */
export const MAX_OPEN_PER_COMPANY = 100;
/** After a company rejects a contractor, the same contractor cannot ask that company again for this long. */
export const REJECT_COOLDOWN_DAYS = 30;
export const MAX_SEARCH_RESULTS = 10;
export const MIN_SEARCH_LENGTH = 3;

type LinkRow = typeof links.$inferSelect;

export interface ContractorDeps {
  searchGuard: ReturnType<typeof createSearchGuard>;
  /** True when the account's email is verified. */
  emailVerified: (userId: string) => Promise<boolean>;
  /**
   * Require a verified email before search or request (Sam 20 Nov, item 2). Off until email verification exists:
   * sign-up does not verify addresses yet, so turning it on now would lock every contractor out.
   */
  requireVerifiedEmail: boolean;
  now: () => Date;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** A contractor sees a block as a plain rejection; the company's decision is not explained. */
const toLink = (r: SelfLink): ContractorLink => ({
  id: encodeId('contractorLink', r.id),
  companyName: r.companyName,
  status: r.status === 'blocked' ? 'rejected' : r.status,
  requestedAt: r.requestedAt.toISOString(),
  decidedAt: iso(r.decidedAt),
});

/** Escapes LIKE wildcards so a search for "100%" matches the text, not everything. */
export const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

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
  requestLink(userId: string, listingPublicId: string): Promise<ContractorLink>;
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
    to: 'accepted' | 'rejected' | 'blocked',
  ): Promise<CompanyContractor>;
  endForCompany(scope: TenantScope, linkPublicId: string): Promise<void>;
  getListing(scope: TenantScope): Promise<ContractorListing>;
  setListing(scope: TenantScope, listed: boolean): Promise<ContractorListing>;
}

export function createContractorService(
  database: Database,
  deps: ContractorDeps,
): ContractorService {
  const { now } = deps;
  const repo = createLinksRepo(database);

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
  async function requireContractor(userId: string) {
    const p = await readProfile(userId);
    if (!p) throw new AppError('contractor.profile_required');
    if (deps.requireVerifiedEmail && !(await deps.emailVerified(userId)))
      throw new AppError('contractor.email_unverified', 'Verify your email address first.');
    return p;
  }

  async function withProfile(scope: TenantScope, row: LinkRow) {
    const [p] = await scope.tx
      .select()
      .from(profiles)
      .where(eq(profiles.userId, row.contractorUserId));
    return toCompanyContractor(row, p ?? null);
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
      const profile = await requireContractor(userId);
      const term = q.trim();
      if (term.length < MIN_SEARCH_LENGTH)
        throw new AppError('validation_failed', `Type at least ${MIN_SEARCH_LENGTH} characters.`);
      await deps.searchGuard.check(userId, profile.createdAt, term);
      const found = await database.withGlobalTx('contractors', (tx) =>
        tx
          .select()
          .from(directory)
          .where(and(eq(directory.listed, true), ilike(directory.name, `%${likeEscape(term)}%`)))
          .orderBy(directory.name)
          .limit(MAX_SEARCH_RESULTS),
      );
      const status = found.length
        ? await repo.statusByCompany(
            userId,
            found.map((f) => f.companyId),
          )
        : new Map<string, LinkStatus>();
      return {
        data: found.map((f) => {
          const s = status.get(f.companyId) ?? null;
          return {
            id: encodeId('companyListing', f.listingId),
            name: f.name,
            abnLast3: f.abnLast3,
            linkStatus: s === 'blocked' ? 'rejected' : s,
          };
        }),
      };
    },

    async listMyLinks(userId, o) {
      const before = o.cursor ? decodeId('contractorLink', o.cursor) : null;
      const rows = await repo.listOwn(userId, { ...o, before, limit: o.limit + 1 });
      const page = rows.slice(0, o.limit);
      return {
        data: page.map(toLink),
        nextCursor:
          rows.length > o.limit ? encodeId('contractorLink', page[page.length - 1]!.id) : null,
      };
    },

    async requestLink(userId, listingPublicId) {
      await requireContractor(userId);
      const listingId = decodeId('companyListing', listingPublicId);
      if (!listingId) throw new AppError('org.not_found');
      // The company comes from this server-side lookup (listed, not deleted), never from the request.
      const company = await database.withGlobalTx('contractors', async (tx) => {
        const [d] = await tx
          .select()
          .from(directory)
          .where(and(eq(directory.listingId, listingId), eq(directory.listed, true)));
        return d ?? null;
      });
      if (!company) throw new AppError('org.not_found');
      if ((await repo.countOpenOwn(userId)) >= MAX_OPEN_REQUESTS)
        throw new AppError('contractor_link.too_many_requests');
      return toLink(
        await repo.request(company.companyId, userId, {
          id: uuidv7(),
          companyName: company.name,
          now: now(),
          cooldownMs: REJECT_COOLDOWN_DAYS * 86_400_000,
          maxOpenPerCompany: MAX_OPEN_PER_COMPANY,
        }),
      );
    },

    /** Cancels a pending request or ends an accepted link, as a status change. Anything else is left alone. */
    async removeMyLink(userId, linkPublicId) {
      const id = decodeId('contractorLink', linkPublicId);
      if (!id) return;
      const orgId = await repo.companyOfOwn(userId, id);
      if (orgId) await repo.withdraw(orgId, userId, id, now());
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
      if (to !== 'blocked' && row.status !== 'requested')
        throw new AppError('conflict', 'This request has already been decided.');
      const [updated] = await scope.tx
        .update(links)
        .set({ status: to, decidedAt: now() })
        .where(where)
        .returning();
      await scope.tx
        .insert(linkDecisions)
        .values({ orgId: scope.ctx.orgId, linkId: id, decidedBy: scope.ctx.userId })
        .onConflictDoUpdate({
          target: linkDecisions.linkId,
          set: { decidedBy: scope.ctx.userId, decidedAt: now() },
        });
      return withProfile(scope, updated!);
    },

    async endForCompany(scope, linkPublicId) {
      const id = decodeId('contractorLink', linkPublicId);
      if (!id) return;
      await scope.tx
        .update(links)
        .set({ status: 'ended', decidedAt: now() })
        .where(
          and(eq(links.id, id), eq(links.orgId, scope.ctx.orgId), eq(links.status, 'accepted')),
        );
    },

    async getListing(scope) {
      const [d] = await scope.tx
        .select({ listed: directory.listed })
        .from(directory)
        .where(eq(directory.companyId, scope.ctx.orgId));
      return { listed: d?.listed ?? false };
    },

    /** Opt in or out of name search. Creates the directory row from the org if the trigger never saw it. */
    async setListing(scope, listed) {
      const orgId = scope.ctx.orgId;
      await scope.tx.execute(sql`
        insert into contractors.directory (company_id, name, abn_last3, listed)
        select id, name, case when abn is null then null else right(abn::text, 3) end, ${listed}
          from platform.orgs where id = ${orgId}::uuid and deleted_at is null
        on conflict (company_id) do update set listed = excluded.listed, updated_at = now()`);
      return this.getListing(scope);
    },
  };
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
