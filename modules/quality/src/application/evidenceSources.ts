import { and, between, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { localDateOf, startOfLocalDay, endOfLocalDay } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { inspectionLabel } from '../domain/inspection';
import { inspections, responses } from '../infra/tables';
import type { QualityDeps } from './shared';

const LIMIT = 2000;

/**
 * Inspections in a date range for the regulator evidence pack (`reporting`): scheduled or completed inside it.
 * Needs `quality.inspections.read` on the project. Rows carry the reference, title, status, dates and pass/fail counts.
 */
export function createEvidenceSources(deps: QualityDeps) {
  async function inspectionRows(
    scope: TenantScope,
    projectId: string,
    range: { from: string; to: string },
  ) {
    if (!(await deps.access.can(scope, 'quality.inspections.read', { projectId })))
      return { restricted: true, truncated: false, rows: [] };
    const { timezone } = await deps.platform.getProject(scope, projectId);
    const found = await scope.tx
      .select({
        id: inspections.id,
        number: inspections.number,
        title: inspections.title,
        status: inspections.status,
        scheduledFor: inspections.scheduledFor,
        completedAt: inspections.completedAt,
      })
      .from(inspections)
      .where(
        and(
          eq(inspections.projectId, projectId),
          isNull(inspections.deletedAt),
          or(
            between(inspections.scheduledFor, range.from, range.to),
            between(
              inspections.completedAt,
              startOfLocalDay(range.from, timezone),
              endOfLocalDay(range.to, timezone),
            ),
          ),
        ),
      )
      .orderBy(inspections.number)
      .limit(LIMIT + 1);
    const kept = found.slice(0, LIMIT);
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
    return {
      restricted: false,
      truncated: found.length > LIMIT,
      rows: kept.map((r) => ({
        ref: inspectionLabel(r.number),
        title: r.title,
        status: r.status,
        scheduledFor: r.scheduledFor,
        completedOn: r.completedAt ? localDateOf(r.completedAt, timezone) : null,
        pass: tally.get(r.id)?.pass ?? 0,
        fail: tally.get(r.id)?.fail ?? 0,
      })),
    };
  }
  return { inspections: inspectionRows };
}
