import { and, desc, eq, isNull } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import { dashboardSnapshots } from '../infra/tables';
import type { PortfolioService } from './portfolio';

export interface SnapshotDeps {
  identity: Pick<IdentityApi, 'getUsers'>;
}

export interface SnapshotInput {
  title: string;
  currentAsOf?: string;
  program?: string | null;
}

const isAdmin = (scope: TenantScope) =>
  scope.ctx.orgRole === 'owner' || scope.ctx.orgRole === 'admin';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar day, or null. */
function validDay(s: string): string | null {
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) ? s : null;
}

/**
 * Dashboard snapshots: the whole portfolio dashboard saved as data at a moment, with a title, a "current as of" day
 * and an optional programme tag. Opening one returns the dashboard exactly as it was. The numbers were narrowed to what
 * the maker could open, so a snapshot is visible only to its maker and to org owners and admins.
 */
export function createSnapshotService(
  deps: SnapshotDeps,
  portfolio: Pick<PortfolioService, 'get'>,
) {
  type Row = typeof dashboardSnapshots.$inferSelect;

  const visible = (scope: TenantScope) =>
    and(
      isNull(dashboardSnapshots.deletedAt),
      isAdmin(scope) ? undefined : eq(dashboardSnapshots.createdBy, scope.ctx.userId),
    );

  async function names(rows: readonly Row[]) {
    const users = await deps.identity.getUsers(rows.map((r) => r.createdBy));
    return (id: string) => users.get(id)?.name ?? null;
  }

  const dto = (r: Row, nameOf: (id: string) => string | null) => ({
    id: encodeId('dashboardSnapshot', r.id),
    title: r.title,
    currentAsOf: r.currentAsOf,
    program: r.program,
    createdAt: r.createdAt.toISOString(),
    createdBy: { id: encodeId('user', r.createdBy), name: nameOf(r.createdBy) },
  });

  async function find(scope: TenantScope, id: string): Promise<Row> {
    const [row] = await scope.tx
      .select()
      .from(dashboardSnapshots)
      .where(and(eq(dashboardSnapshots.id, id), visible(scope)))
      .limit(1);
    if (!row) throw new AppError('snapshot.not_found');
    return row;
  }

  async function list(scope: TenantScope) {
    const rows = await scope.tx
      .select()
      .from(dashboardSnapshots)
      .where(visible(scope))
      .orderBy(desc(dashboardSnapshots.currentAsOf), desc(dashboardSnapshots.id))
      .limit(500);
    const nameOf = await names(rows);
    return { data: rows.map((r) => dto(r, nameOf)) };
  }

  async function get(scope: TenantScope, id: string) {
    const row = await find(scope, id);
    const nameOf = await names([row]);
    return { ...dto(row, nameOf), dashboard: row.data };
  }

  /** Captures the dashboard now, exactly as the caller sees it (open projects, as on the Portfolio page). */
  async function create(
    scope: TenantScope,
    input: SnapshotInput,
    today: string = new Date().toISOString().slice(0, 10),
  ) {
    const title = input.title.trim();
    if (!title)
      throw new AppError('validation_failed', 'Title is required', [
        { path: 'title', message: 'Required' },
      ]);
    let currentAsOf = today;
    if (input.currentAsOf) {
      const day = validDay(input.currentAsOf);
      if (!day)
        throw new AppError('validation_failed', 'Invalid date', [
          { path: 'currentAsOf', message: 'Invalid date' },
        ]);
      // The caller's local day can be a day ahead of UTC (Australia), so one day of slack.
      const limit = new Date(`${today}T00:00:00Z`);
      limit.setUTCDate(limit.getUTCDate() + 1);
      if (day > limit.toISOString().slice(0, 10))
        throw new AppError('validation_failed', 'A snapshot cannot be dated in the future', [
          { path: 'currentAsOf', message: 'Cannot be in the future' },
        ]);
      currentAsOf = day;
    }
    const program = input.program?.trim() || null;
    if (program && program.length > 80)
      throw new AppError('validation_failed', 'Too long', [
        { path: 'program', message: 'At most 80 characters' },
      ]);
    const dashboard = await portfolio.get(scope, { includeClosed: false });
    const row: Row = {
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      title,
      currentAsOf,
      program,
      data: dashboard,
      createdAt: new Date(),
      createdBy: scope.ctx.userId,
      deletedAt: null,
    };
    await scope.tx.insert(dashboardSnapshots).values(row);
    const nameOf = await names([row]);
    return { ...dto(row, nameOf), dashboard };
  }

  async function remove(scope: TenantScope, id: string) {
    const row = await find(scope, id);
    await scope.tx
      .update(dashboardSnapshots)
      .set({ deletedAt: new Date() })
      .where(eq(dashboardSnapshots.id, row.id));
  }

  return {
    list,
    get,
    create,
    remove,
    decode: (publicId: string) => decodeId('dashboardSnapshot', publicId),
  };
}

export type SnapshotService = ReturnType<typeof createSnapshotService>;
