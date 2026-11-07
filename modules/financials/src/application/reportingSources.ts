import { and, asc, eq, inArray } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import {
  CLOSED_CLAIM_STATES,
  CLOSED_VARIATION_STATES,
  OPEN_CLAIM_STATES,
  OPEN_VARIATION_STATES,
  claimDueDate,
  claimOverdue,
} from '../domain/portfolio';
import { contracts, paymentClaims, variations } from '../infra/tables';

type State = 'open' | 'closed' | 'all';
interface Deps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

const RESTRICTED = { restricted: true, open: 0, overdue: 0 };
const NO_ROWS = { rows: [], truncated: false, restricted: true };

/**
 * Feeds `reporting` (portfolio counts and report rows) for payment claims and variations. Both are the builder's
 * commercial position, so they need the same read permission as the contract screens and, like contracts, are shown
 * to staff only: a subcontractor never reaches the portfolio, and a project the caller cannot read shows `restricted`.
 */
export function createReportingSources(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const today = async (scope: TenantScope, projectId: string) =>
    localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
  const allowed = async (scope: TenantScope, projectId: string) =>
    scope.ctx.principalType === 'member' &&
    (await deps.access.can(scope, 'financials.claims.read', { projectId }));

  const claimStates = (state: State) =>
    state === 'open'
      ? OPEN_CLAIM_STATES
      : state === 'closed'
        ? CLOSED_CLAIM_STATES
        : [...OPEN_CLAIM_STATES, ...CLOSED_CLAIM_STATES];
  const variationStates = (state: State) =>
    state === 'open'
      ? OPEN_VARIATION_STATES
      : state === 'closed'
        ? CLOSED_VARIATION_STATES
        : [...OPEN_VARIATION_STATES, ...CLOSED_VARIATION_STATES];

  async function claimCounts(scope: TenantScope, projectId: string) {
    if (!(await allowed(scope, projectId))) return RESTRICTED;
    const date = await today(scope, projectId);
    const rows = await scope.tx
      .select({
        status: paymentClaims.status,
        scheduleDueOn: paymentClaims.scheduleDueOn,
        paymentDueOn: paymentClaims.paymentDueOn,
      })
      .from(paymentClaims)
      .where(
        and(
          eq(paymentClaims.projectId, projectId),
          inArray(paymentClaims.status, [...OPEN_CLAIM_STATES]),
        ),
      );
    return {
      restricted: false,
      open: rows.length,
      overdue: rows.filter((r) => claimOverdue(r, date)).length,
    };
  }

  async function claimRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: State; limit: number },
  ) {
    if (!(await allowed(scope, projectId))) return NO_ROWS;
    const date = await today(scope, projectId);
    const found = await scope.tx
      .select({
        id: paymentClaims.id,
        number: paymentClaims.number,
        contractTitle: contracts.title,
        status: paymentClaims.status,
        scheduleDueOn: paymentClaims.scheduleDueOn,
        paymentDueOn: paymentClaims.paymentDueOn,
        createdAt: paymentClaims.createdAt,
      })
      .from(paymentClaims)
      .innerJoin(contracts, eq(contracts.id, paymentClaims.contractId))
      .where(
        and(
          eq(paymentClaims.projectId, projectId),
          inArray(paymentClaims.status, [...claimStates(opts.state)]),
        ),
      )
      .orderBy(asc(paymentClaims.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: `PC-${r.number}`,
        title: r.contractTitle,
        status: r.status,
        dueDate: claimDueDate(r),
        overdue: claimOverdue(r, date),
        createdAt: r.createdAt.toISOString(),
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  async function variationCounts(scope: TenantScope, projectId: string) {
    if (!(await allowed(scope, projectId))) return RESTRICTED;
    const rows = await scope.tx
      .select({ id: variations.id })
      .from(variations)
      .where(
        and(
          eq(variations.projectId, projectId),
          inArray(variations.status, [...OPEN_VARIATION_STATES]),
        ),
      );
    // A variation has no statutory due date, so none is ever overdue.
    return { restricted: false, open: rows.length, overdue: 0 };
  }

  async function variationRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: State; limit: number },
  ) {
    if (!(await allowed(scope, projectId))) return NO_ROWS;
    const found = await scope.tx
      .select({
        id: variations.id,
        number: variations.number,
        title: variations.title,
        status: variations.status,
        createdAt: variations.createdAt,
      })
      .from(variations)
      .where(
        and(
          eq(variations.projectId, projectId),
          inArray(variations.status, [...variationStates(opts.state)]),
        ),
      )
      .orderBy(asc(variations.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: `VO-${r.number}`,
        title: r.title,
        status: r.status,
        dueDate: null,
        overdue: false,
        createdAt: r.createdAt.toISOString(),
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  return {
    claims: { portfolioCounts: claimCounts, reportRows: claimRows },
    variations: { portfolioCounts: variationCounts, reportRows: variationRows },
  };
}
