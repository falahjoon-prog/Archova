import { and, asc, eq, isNull } from 'drizzle-orm';
import type {
  CreateProjectRiskRequest,
  UpdateProjectRiskRequest,
  ProjectRisk,
} from '@archova/contracts';
import { encodeId, uuidv7 } from '@archova/domain';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import type { PlatformApi } from '@archova/mod-platform';
import { isLive, levelOf, score, summarise } from '../domain/risk-register';
import { risks, type RiskStatus } from '../infra/tables';

export interface RiskRegisterDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

type Row = typeof risks.$inferSelect;
const TOP = 5;

export function createRiskRegisterService(deps: RiskRegisterDeps) {
  const now = deps.now ?? (() => new Date());

  const dto = (r: Row): ProjectRisk => {
    const s = score(r.likelihood, r.impact);
    return {
      id: encodeId('projectRisk', r.id),
      projectId: encodeId('project', r.projectId),
      number: r.number,
      title: r.title,
      description: r.description,
      category: r.category,
      likelihood: r.likelihood,
      impact: r.impact,
      score: s,
      level: levelOf(s),
      status: r.status,
      ownerName: r.ownerName,
      mitigation: r.mitigation,
      reviewDate: r.reviewDate,
      closedAt: r.closedAt?.toISOString() ?? null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  };

  const byScore = (a: Row, b: Row) =>
    score(b.likelihood, b.impact) - score(a.likelihood, a.impact) || a.number - b.number;

  async function rows(scope: TenantScope, projectId: string) {
    return scope.tx
      .select()
      .from(risks)
      .where(and(eq(risks.projectId, projectId), isNull(risks.deletedAt)))
      .orderBy(asc(risks.number));
  }

  async function get(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(risks)
      .where(and(eq(risks.id, id), eq(risks.projectId, projectId), isNull(risks.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('risk.not_found');
    return row;
  }

  const clean = (s: string | null | undefined) => s?.trim() || null;

  async function list(scope: TenantScope, projectId: string, status?: RiskStatus) {
    const all = await rows(scope, projectId);
    return {
      data: all
        .filter((r) => !status || r.status === status)
        .sort(byScore)
        .map(dto),
    };
  }

  async function create(scope: TenantScope, projectId: string, input: CreateProjectRiskRequest) {
    await deps.platform.getProject(scope, projectId);
    const status = input.status ?? 'open';
    const [row] = await scope.tx
      .insert(risks)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        number: await nextNumber(scope, projectId, 'risk'),
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        category: input.category,
        likelihood: input.likelihood,
        impact: input.impact,
        status,
        ownerName: clean(input.ownerName),
        mitigation: input.mitigation?.trim() ?? '',
        reviewDate: input.reviewDate ?? null,
        closedAt: isLive(status) ? null : now(),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return dto(row!);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    patch: UpdateProjectRiskRequest,
  ) {
    const current = await get(scope, projectId, id);
    if (current.version !== expected) throw versionConflict();
    const status = patch.status ?? current.status;
    const [row] = await scope.tx
      .update(risks)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.likelihood !== undefined ? { likelihood: patch.likelihood } : {}),
        ...(patch.impact !== undefined ? { impact: patch.impact } : {}),
        ...(patch.ownerName !== undefined ? { ownerName: clean(patch.ownerName) } : {}),
        ...(patch.mitigation !== undefined ? { mitigation: patch.mitigation.trim() } : {}),
        ...(patch.reviewDate !== undefined ? { reviewDate: patch.reviewDate } : {}),
        status,
        closedAt: isLive(status) ? null : (current.closedAt ?? now()),
        version: current.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(risks.id, id), eq(risks.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return dto(row);
  }

  async function remove(scope: TenantScope, projectId: string, id: string) {
    await get(scope, projectId, id);
    await scope.tx
      .update(risks)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(eq(risks.id, id));
  }

  /** The numbers the project health model reads for its risk RAG, plus the top live risks. */
  async function summary(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    const all = await rows(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    return {
      ...summarise(all, today),
      top: all
        .filter((r) => isLive(r.status))
        .sort(byScore)
        .slice(0, TOP)
        .map(dto),
    };
  }

  return { list, create, update, remove, summary };
}

export type RiskRegisterService = ReturnType<typeof createRiskRegisterService>;
