import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import {
  ROWS_PER_PROJECT,
  ROWS_TOTAL,
  normaliseConfig,
  sortRows,
  type ReportConfig,
  type ResultRow,
} from '../domain/report';
import { reports } from '../infra/tables';
import { toolOf, visibleProjects, type ReportingDeps } from './sources';

/** The API form of a config: project ids are public ids. */
type ApiConfig = Omit<ReportConfig, 'projectIds'> & { projectIds: string[] };
export interface ReportInput {
  name: string;
  shared: boolean;
  config: ApiConfig;
}

const isAdmin = (scope: TenantScope) =>
  scope.ctx.orgRole === 'owner' || scope.ctx.orgRole === 'admin';

function decodeConfig(c: ApiConfig): ReportConfig {
  const projectIds = c.projectIds.map((id, i) => {
    const uuid = decodeId('project', id);
    if (!uuid)
      throw new AppError('validation_failed', 'Invalid id', [
        { path: `config/projectIds/${i}`, message: 'Invalid id' },
      ]);
    return uuid;
  });
  return normaliseConfig({ ...c, projectIds });
}

const encodeConfig = (c: ReportConfig): ApiConfig => ({
  ...c,
  projectIds: c.projectIds.map((id) => encodeId('project', id)),
});

export function createReportsService(deps: ReportingDeps) {
  type Row = typeof reports.$inferSelect;
  const dto = (scope: TenantScope, r: Row) => ({
    id: encodeId('report', r.id),
    name: r.name,
    shared: r.shared,
    config: encodeConfig(r.config),
    mine: r.createdBy === scope.ctx.userId || isAdmin(scope),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });

  const visible = (scope: TenantScope) =>
    and(
      isNull(reports.deletedAt),
      or(eq(reports.shared, true), eq(reports.createdBy, scope.ctx.userId)),
    );

  async function find(scope: TenantScope, id: string): Promise<Row> {
    const [row] = await scope.tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), visible(scope)))
      .limit(1);
    if (!row) throw new AppError('report.not_found');
    return row;
  }

  /** A report is changed only by its maker or an org owner or admin. */
  async function findOwned(scope: TenantScope, id: string): Promise<Row> {
    const row = await find(scope, id);
    if (row.createdBy !== scope.ctx.userId && !isAdmin(scope))
      throw new AppError('report.not_owner');
    return row;
  }

  async function list(scope: TenantScope) {
    const rows = await scope.tx
      .select()
      .from(reports)
      .where(visible(scope))
      .orderBy(asc(reports.name), asc(reports.id));
    return { data: rows.map((r) => dto(scope, r)) };
  }

  async function get(scope: TenantScope, id: string) {
    return dto(scope, await find(scope, id));
  }

  async function create(scope: TenantScope, input: ReportInput) {
    const row: Row = {
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      name: input.name.trim(),
      shared: input.shared,
      config: decodeConfig(input.config),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: scope.ctx.userId,
      updatedBy: null,
      deletedAt: null,
    };
    if (!row.name)
      throw new AppError('validation_failed', 'Name is required', [
        { path: 'name', message: 'Required' },
      ]);
    await scope.tx.insert(reports).values(row);
    return dto(scope, row);
  }

  async function update(scope: TenantScope, id: string, input: ReportInput) {
    await findOwned(scope, id);
    const name = input.name.trim();
    if (!name)
      throw new AppError('validation_failed', 'Name is required', [
        { path: 'name', message: 'Required' },
      ]);
    const [row] = await scope.tx
      .update(reports)
      .set({
        name,
        shared: input.shared,
        config: decodeConfig(input.config),
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(reports.id, id))
      .returning();
    return dto(scope, row!);
  }

  async function remove(scope: TenantScope, id: string) {
    await findOwned(scope, id);
    await scope.tx
      .update(reports)
      .set({ deletedAt: new Date(), updatedBy: scope.ctx.userId })
      .where(eq(reports.id, id));
  }

  /** Runs a config for the caller: only rows their own permissions let them open. */
  async function run(scope: TenantScope, config: ReportConfig) {
    const { projects, truncated: moreProjects } = await visibleProjects(deps, scope, {
      includeClosed: true,
    });
    const wanted = config.projectIds.length ? new Set(config.projectIds) : null;
    const tool = toolOf(deps, config.source);
    let truncated = moreProjects && !wanted;
    let restrictedProjects = 0;
    const rows: ResultRow[] = [];
    for (const p of projects) {
      if (wanted && !wanted.has(p.id)) continue;
      if (rows.length >= ROWS_TOTAL) {
        truncated = true;
        break;
      }
      const found = await tool.reportRows(scope, p.id, {
        state: config.state,
        limit: ROWS_PER_PROJECT,
      });
      if (found.restricted) {
        restrictedProjects++;
        continue;
      }
      if (found.truncated) truncated = true;
      for (const r of found.rows) {
        if (config.overdueOnly && !r.overdue) continue;
        rows.push({ ...r, projectId: p.id, project: p.name });
      }
    }
    const sorted = sortRows(rows);
    const kept = sorted.slice(0, ROWS_TOTAL);
    if (kept.length < sorted.length) truncated = true;
    return {
      columns: config.columns,
      rows: kept.map((r) => ({
        projectId: encodeId('project', r.projectId),
        project: r.project,
        ref: r.ref,
        title: r.title,
        status: r.status,
        dueDate: r.dueDate,
        overdue: r.overdue,
        createdAt: r.createdAt,
      })),
      restrictedProjects,
      truncated,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    preview: (scope: TenantScope, config: ApiConfig) => run(scope, decodeConfig(config)),
    runSaved: async (scope: TenantScope, id: string) => run(scope, (await find(scope, id)).config),
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
