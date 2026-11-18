import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import type { DbpInspectionRow, DbpObservationRow } from '../domain/dbp';
import { inspections, observations, responses, templates } from '../infra/tables';
import type { QualityDeps } from './shared';

/** Cap per project so one huge register cannot make the dashboard slow; `truncated` says when it was hit. */
export const DBP_ROW_LIMIT = 5000;

export interface DbpRows {
  restricted: boolean;
  truncated: boolean;
  inspections: DbpInspectionRow[];
  observations: DbpObservationRow[];
}

/**
 * Feeds `reporting` (the DBP Act insights view). Needs `quality.inspections.read` on the project, which is builder
 * staff only; rows carry categories, counts and dates, never text, names or people.
 */
export function createDbpSources(deps: QualityDeps) {
  const now = deps.now ?? (() => new Date());

  async function dbpRows(scope: TenantScope, projectId: string): Promise<DbpRows> {
    const empty = { inspections: [], observations: [] };
    if (!(await deps.access.can(scope, 'quality.inspections.read', { projectId })))
      return { restricted: true, truncated: false, ...empty };
    const { timezone } = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), timezone);

    const inspectionRows = await scope.tx
      .select({
        id: inspections.id,
        status: inspections.status,
        scheduledFor: inspections.scheduledFor,
        completedAt: inspections.completedAt,
        tradeCategory: templates.tradeCategory,
      })
      .from(inspections)
      .innerJoin(templates, eq(templates.id, inspections.templateId))
      .where(and(eq(inspections.projectId, projectId), isNull(inspections.deletedAt)))
      .limit(DBP_ROW_LIMIT + 1);
    const truncatedInspections = inspectionRows.length > DBP_ROW_LIMIT;
    const kept = inspectionRows.slice(0, DBP_ROW_LIMIT);

    const tallies = kept.length
      ? await scope.tx
          .select({
            inspectionId: responses.inspectionId,
            pass: sql<number>`count(*) filter (where ${responses.result} = 'pass')::int`,
            fail: sql<number>`count(*) filter (where ${responses.result} = 'fail')::int`,
          })
          .from(responses)
          .where(
            inArray(
              responses.inspectionId,
              kept.map((r) => r.id),
            ),
          )
          .groupBy(responses.inspectionId)
      : [];
    const tally = new Map(tallies.map((t) => [t.inspectionId, t]));

    const observationRows = await scope.tx
      .select({
        tradeCategory: observations.tradeCategory,
        classification: observations.classification,
        contributingCondition: observations.contributingCondition,
        status: observations.status,
        dueDate: observations.dueDate,
      })
      .from(observations)
      .where(
        and(
          eq(observations.projectId, projectId),
          isNull(observations.deletedAt),
          ne(observations.status, 'closed'),
        ),
      )
      .limit(DBP_ROW_LIMIT + 1);

    return {
      restricted: false,
      truncated: truncatedInspections || observationRows.length > DBP_ROW_LIMIT,
      inspections: kept.map((r) => {
        const t = tally.get(r.id);
        const done = r.status === 'submitted' || r.status === 'closed';
        return {
          tradeCategory: r.tradeCategory,
          late: !done && r.scheduledFor !== null && r.scheduledFor < today,
          completedOn: done && r.completedAt ? localDateOf(r.completedAt, timezone) : null,
          pass: t?.pass ?? 0,
          fail: t?.fail ?? 0,
        };
      }),
      observations: observationRows.slice(0, DBP_ROW_LIMIT).map((r) => ({
        tradeCategory: r.tradeCategory,
        classification: r.classification,
        contributingCondition: r.contributingCondition,
        late: r.status === 'open' && r.dueDate !== null && r.dueDate < today,
      })),
    };
  }

  return { dbpRows };
}
