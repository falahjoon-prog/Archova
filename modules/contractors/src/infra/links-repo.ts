// The only place the contractors module opens a contractor-scope transaction (`withContractorTx`, role
// `app_contractor`) or reads links in self scope. Both go through named columns, so a column added to
// `contractors.links` later is never exposed to a contractor by accident (ADR-0007 amendment 1, items 4 and 5).
import { and, count, desc, eq, ilike, lt } from 'drizzle-orm';
import { AppError, type Database } from '@archova/kernel';
import { links, type LinkStatus } from './tables';

/** The columns a contractor may ever read from a link row. */
const SELF_COLUMNS = {
  id: links.id,
  companyName: links.companyName,
  status: links.status,
  requestedAt: links.requestedAt,
  decidedAt: links.decidedAt,
} as const;
export type SelfLink = {
  id: string;
  companyName: string;
  status: LinkStatus;
  requestedAt: Date;
  decidedAt: Date | null;
};

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createLinksRepo(database: Database) {
  return {
    listOwn(
      userId: string,
      o: {
        q?: string | undefined;
        status?: LinkStatus | undefined;
        limit: number;
        before?: string | null;
      },
    ): Promise<SelfLink[]> {
      return database.withSelfTx(userId, (tx) =>
        tx
          .select(SELF_COLUMNS)
          .from(links)
          .where(
            and(
              eq(links.contractorUserId, userId),
              o.status ? eq(links.status, o.status) : undefined,
              o.q?.trim() ? ilike(links.companyName, `%${escapeLike(o.q.trim())}%`) : undefined,
              o.before ? lt(links.id, o.before) : undefined,
            ),
          )
          .orderBy(desc(links.id))
          .limit(o.limit),
      );
    },

    statusByCompany(userId: string, companyIds: string[]): Promise<Map<string, LinkStatus>> {
      return database
        .withSelfTx(userId, (tx) =>
          tx
            .select({ orgId: links.orgId, status: links.status })
            .from(links)
            .where(eq(links.contractorUserId, userId)),
        )
        .then(
          (rows) =>
            new Map(
              rows.filter((r) => companyIds.includes(r.orgId)).map((r) => [r.orgId, r.status]),
            ),
        );
    },

    /** Open requests this contractor has across every company. A race can overshoot the cap slightly; that is accepted. */
    countOpenOwn(userId: string): Promise<number> {
      return database.withSelfTx(userId, async (tx) => {
        const [r] = await tx
          .select({ n: count() })
          .from(links)
          .where(and(eq(links.contractorUserId, userId), eq(links.status, 'requested')));
        return r?.n ?? 0;
      });
    },

    /** Ask a company to add the caller. Re-asking after cancelled/ended/old rejection updates the same row. */
    request(
      orgId: string,
      userId: string,
      o: {
        id: string;
        companyName: string;
        now: Date;
        cooldownMs: number;
        maxOpenPerCompany: number;
      },
    ): Promise<SelfLink> {
      return database.withContractorTx(orgId, userId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(links)
          .where(and(eq(links.orgId, orgId), eq(links.contractorUserId, userId)));
        if (existing && (existing.status === 'requested' || existing.status === 'accepted'))
          return pick(existing);
        const busy = "This company isn't accepting your request right now.";
        if (existing?.status === 'blocked')
          throw new AppError('contractor_link.rejected_recently', busy);
        if (
          existing?.status === 'rejected' &&
          existing.decidedAt &&
          o.now.getTime() - existing.decidedAt.getTime() < o.cooldownMs
        )
          throw new AppError('contractor_link.rejected_recently', busy);

        const [open] = await tx
          .select({ n: count() })
          .from(links)
          .where(and(eq(links.orgId, orgId), eq(links.status, 'requested')));
        if ((open?.n ?? 0) >= o.maxOpenPerCompany)
          throw new AppError('contractor_link.company_busy');

        const fresh = {
          companyName: o.companyName,
          status: 'requested' as const,
          requestedAt: o.now,
          decidedAt: null,
        };
        const [row] = existing
          ? await tx
              .update(links)
              .set(fresh)
              .where(and(eq(links.orgId, orgId), eq(links.contractorUserId, userId)))
              .returning()
          : await tx
              .insert(links)
              .values({ id: o.id, orgId, contractorUserId: userId, ...fresh })
              .returning();
        return pick(row!);
      });
    },

    /** Cancel a pending request or end an accepted link: a status change, never a delete. */
    async withdraw(orgId: string, userId: string, linkId: string, now: Date): Promise<void> {
      await database.withContractorTx(orgId, userId, async (tx) => {
        const own = and(
          eq(links.id, linkId),
          eq(links.orgId, orgId),
          eq(links.contractorUserId, userId),
        );
        await tx
          .update(links)
          .set({ status: 'cancelled', decidedAt: now })
          .where(and(own, eq(links.status, 'requested')));
        await tx
          .update(links)
          .set({ status: 'ended', decidedAt: now })
          .where(and(own, eq(links.status, 'accepted')));
      });
    },

    /** Which company a link of the caller's is in (self scope), for withdraw. */
    async companyOfOwn(userId: string, linkId: string): Promise<string | null> {
      const [r] = await database.withSelfTx(userId, (tx) =>
        tx
          .select({ orgId: links.orgId })
          .from(links)
          .where(and(eq(links.id, linkId), eq(links.contractorUserId, userId))),
      );
      return r?.orgId ?? null;
    },
  };
}

function pick(r: SelfLink & Record<string, unknown>): SelfLink {
  return {
    id: r.id,
    companyName: r.companyName,
    status: r.status,
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt,
  };
}
