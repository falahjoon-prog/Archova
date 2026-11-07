// Staff-granted Nova credits (ai/05 §4–§5). The owner console calls `grant`; the gateway and the usage view read
// `grantedFor` so a grant lifts that month's allowance. Grants are append-only and expire with their month.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CreditGrantKind } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type Entitlements, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { creditGrants } from '../infra/tables';

/** One grant is at most this many credits; a bigger one is several entries, each with its own reason. */
export const MAX_GRANT_CREDITS = 1000;

export interface CreditGrant {
  id: string;
  periodStart: string;
  credits: number;
  kind: CreditGrantKind;
  reason: string;
  ticketRef: string;
  grantedBy: string;
  createdAt: Date;
}

/** Entitlements are not read for a grant, which touches only the ai ledger. */
const NO_ENTITLEMENTS: Entitlements = { plan: 'none', state: 'active', modules: [], limits: {} };

export const monthStartOf = (day: string) => `${day.slice(0, 7)}-01`;

export function createCreditGrantService(deps: {
  database: Database;
  orgTimeZone: (scope: TenantScope) => Promise<string>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  /** Credits granted to the caller's org for the month that contains `monthStart`. */
  async function grantedFor(scope: TenantScope, monthStart: string): Promise<number> {
    const [row] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${creditGrants.credits}), 0)` })
      .from(creditGrants)
      .where(
        and(eq(creditGrants.orgId, scope.ctx.orgId), eq(creditGrants.periodStart, monthStart)),
      );
    return Number(row?.total ?? 0);
  }

  /** Adds credits to the org's current month, as of its local calendar. Staff acting for the org, not a member. */
  async function grant(
    orgId: string,
    staffId: string,
    input: { credits: number; kind: CreditGrantKind; reason: string; ticketRef: string },
  ): Promise<{ id: string; periodStart: string }> {
    if (!(input.credits > 0) || input.credits > MAX_GRANT_CREDITS)
      throw new AppError(
        'ai.credit_grant.invalid',
        `A grant is more than 0 and at most ${MAX_GRANT_CREDITS} credits.`,
      );
    const ctx = {
      orgId,
      userId: staffId,
      principalType: 'member' as const,
      orgRole: null,
      entitlements: NO_ENTITLEMENTS,
      requestId: `staff-grant-${uuidv7()}`,
    };
    return deps.database.withTenantTx(ctx, async (scope) => {
      const tz = await deps.orgTimeZone(scope);
      const periodStart = monthStartOf(localDateOf(now(), tz));
      const id = uuidv7();
      await scope.tx.insert(creditGrants).values({
        id,
        orgId,
        periodStart,
        credits: Math.round(input.credits * 100) / 100,
        kind: input.kind,
        reason: input.reason,
        ticketRef: input.ticketRef,
        grantedBy: staffId,
      });
      return { id, periodStart };
    });
  }

  /** The org's most recent grants, newest first, for the owner console. */
  async function list(orgId: string, staffId: string, limit = 20): Promise<CreditGrant[]> {
    const ctx = {
      orgId,
      userId: staffId,
      principalType: 'member' as const,
      orgRole: null,
      entitlements: NO_ENTITLEMENTS,
      requestId: `staff-grants-${uuidv7()}`,
    };
    return deps.database.withTenantTx(
      ctx,
      (scope) =>
        scope.tx
          .select({
            id: creditGrants.id,
            periodStart: creditGrants.periodStart,
            credits: creditGrants.credits,
            kind: creditGrants.kind,
            reason: creditGrants.reason,
            ticketRef: creditGrants.ticketRef,
            grantedBy: creditGrants.grantedBy,
            createdAt: creditGrants.createdAt,
          })
          .from(creditGrants)
          .where(eq(creditGrants.orgId, orgId))
          .orderBy(desc(creditGrants.createdAt))
          .limit(limit),
      { readOnly: true },
    );
  }

  return { grantedFor, grant, list };
}

export type CreditGrantService = ReturnType<typeof createCreditGrantService>;
