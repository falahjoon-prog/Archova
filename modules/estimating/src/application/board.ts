import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { AppError, type TenantScope } from '@archova/kernel';
import { dueState, lowestLevelledCents, tallyInvites } from '../domain/board';
import { fromCents, toCents, type PackageStatus } from '../domain/tender';
import { packageInvites, quotes, tenderPackages } from '../infra/tables';
import type { EstimatingDeps } from './tender';

export interface BoardRow {
  id: string;
  projectId: string;
  projectName: string;
  number: number;
  name: string;
  trade: string;
  status: PackageStatus;
  dueAt: Date | null;
  dueState: ReturnType<typeof dueState>;
  invites: ReturnType<typeof tallyInvites>;
  /** Quotes confirmed and in the running. */
  quotesConfirmed: number;
  /** Quotes received but not yet confirmed (Nova is reading, or waiting for the estimator). */
  quotesToReview: number;
  /** Lowest levelled ex-GST total, decimal string. */
  lowestExGst: string | null;
  awarded: boolean;
}

export interface BoardOptions {
  status?: PackageStatus;
  trade?: string;
  projectId?: string;
}

const BOARD_LIMIT = 500;

/**
 * The bid board: every tender package across the company's projects that the caller can review quotes on, with
 * how the invitees have answered and where the price stands. Builder staff only; competing prices are the estimator's,
 * so a project where the caller lacks `estimating.quotes.review` is left out rather than shown without prices.
 */
export function createBoardService(deps: EstimatingDeps) {
  const now = deps.now ?? (() => new Date());

  async function board(scope: TenantScope, opts: BoardOptions) {
    if (scope.ctx.principalType !== 'member') {
      throw new AppError('access.denied', "You don't have permission to do that.");
    }
    const conditions = [isNull(tenderPackages.deletedAt)];
    if (opts.status) conditions.push(eq(tenderPackages.status, opts.status));
    if (opts.trade) conditions.push(eq(tenderPackages.trade, opts.trade));
    if (opts.projectId) conditions.push(eq(tenderPackages.projectId, opts.projectId));
    const rows = await scope.tx
      .select()
      .from(tenderPackages)
      .where(and(...conditions))
      .orderBy(asc(tenderPackages.dueAt), asc(tenderPackages.id))
      .limit(BOARD_LIMIT);

    const allowed = new Map<string, { name: string; timezone: string } | null>();
    for (const projectId of new Set(rows.map((r) => r.projectId))) {
      const ok = await deps.access.can(scope, 'estimating.quotes.review', { projectId });
      if (!ok) {
        allowed.set(projectId, null);
        continue;
      }
      const p = await deps.platform.getProject(scope, projectId).catch(() => null);
      allowed.set(projectId, p ? { name: p.name, timezone: p.timezone } : null);
    }
    const visible = rows.filter((r) => allowed.get(r.projectId));
    const ids = visible.map((r) => r.id);
    const [invites, quoteRows] = ids.length
      ? await Promise.all([
          scope.tx.select().from(packageInvites).where(inArray(packageInvites.packageId, ids)),
          scope.tx
            .select({
              id: quotes.id,
              packageId: quotes.packageId,
              status: quotes.status,
              totalExGst: quotes.totalExGst,
            })
            .from(quotes)
            .where(inArray(quotes.packageId, ids)),
        ])
      : [[], []];

    const at = now();
    const data: BoardRow[] = visible.map((r) => {
      const mine = quoteRows.filter((q) => q.packageId === r.id);
      const cents = lowestLevelledCents(mine, r.allowances, toCents);
      return {
        id: r.id,
        projectId: r.projectId,
        projectName: allowed.get(r.projectId)!.name,
        number: r.number,
        name: r.name,
        trade: r.trade,
        status: r.status,
        dueAt: r.dueAt,
        dueState: dueState(r.status, r.dueAt, at),
        invites: tallyInvites(invites.filter((i) => i.packageId === r.id).map((i) => i.status)),
        quotesConfirmed: mine.filter((q) => q.status === 'confirmed').length,
        quotesToReview: mine.filter((q) => q.status === 'reading' || q.status === 'ready_to_review')
          .length,
        lowestExGst: cents === null ? null : fromCents(cents),
        awarded: r.status === 'awarded',
      };
    });
    return { data, asOf: at, truncated: rows.length === BOARD_LIMIT };
  }

  return { board };
}

export type BoardService = ReturnType<typeof createBoardService>;
