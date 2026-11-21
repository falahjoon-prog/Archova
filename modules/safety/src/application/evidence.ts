import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import { endOfLocalDay, localDateOf, startOfLocalDay } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { incidentLabel } from '../domain/incident';
import { pretaskLabel } from '../domain/pretask';
import { toolboxLabel } from '../domain/toolbox';
import {
  incidentActions,
  incidents,
  pretaskCrew,
  pretaskPlans,
  toolboxAttendees,
  toolboxTalks,
} from '../infra/tables';
import type { SafetyDeps } from './swms';

const LIMIT = 2000;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const none = { restricted: true, truncated: false, rows: [] as never[] };

/**
 * Safety records of one project in a local date range, for the regulator evidence pack (`reporting`): incidents and
 * their corrective actions, pre-task plans and toolbox talks. Each section needs its own permission and is `restricted`
 * without it. Incidents need `manage` (builder staff), because anyone else sees only what they reported. People are
 * named only where the record itself is a sign-on (crew and attendee counts, never injury or medical detail).
 */
export function createEvidenceSource(deps: Pick<SafetyDeps, 'access' | 'platform'>) {
  const can = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.can(scope, key, { projectId });

  async function evidenceRecords(
    scope: TenantScope,
    projectId: string,
    range: { from: string; to: string },
  ) {
    const { timezone } = await deps.platform.getProject(scope, projectId);
    const start = startOfLocalDay(range.from, timezone);
    const end = endOfLocalDay(range.to, timezone);
    const [incidentsOk, pretaskOk, toolboxOk] = await Promise.all([
      can(scope, 'safety.incidents.manage', projectId),
      can(scope, 'safety.pretask.read', projectId),
      can(scope, 'safety.toolbox.read', projectId),
    ]);

    let incidentSection: Awaited<ReturnType<typeof incidentRows>>['incidents'] = none;
    let actionSection: Awaited<ReturnType<typeof incidentRows>>['actions'] = none;
    if (incidentsOk)
      ({ incidents: incidentSection, actions: actionSection } = await incidentRows());

    async function incidentRows() {
      const found = await scope.tx
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.projectId, projectId),
            isNull(incidents.deletedAt),
            between(incidents.occurredAt, start, end),
          ),
        )
        .orderBy(asc(incidents.number))
        .limit(LIMIT + 1);
      const kept = found.slice(0, LIMIT);
      const byId = new Map(kept.map((i) => [i.id, i]));
      const acts = kept.length
        ? await scope.tx
            .select()
            .from(incidentActions)
            .where(
              inArray(
                incidentActions.incidentId,
                kept.map((i) => i.id),
              ),
            )
            .orderBy(asc(incidentActions.incidentId), asc(incidentActions.number))
        : [];
      return {
        incidents: {
          restricted: false,
          truncated: found.length > LIMIT,
          rows: kept.map((i) => ({
            ref: incidentLabel(i.number),
            title: i.title,
            type: i.type,
            severity: i.severity,
            occurredAt: i.occurredAt.toISOString(),
            location: i.location,
            status: i.status,
            isNotifiable: i.isNotifiable,
            notifiableClass: i.notifiableClass,
            regulatorNotifiedAt: iso(i.regulatorNotifiedAt),
            writtenNoticeRequestedAt: iso(i.writtenNoticeRequestedAt),
            hasRootCause: !!i.rootCause?.summary?.trim(),
            closedAt: iso(i.closedAt),
          })),
        },
        actions: {
          restricted: false,
          truncated: false,
          rows: acts.map((a) => ({
            incidentRef: incidentLabel(byId.get(a.incidentId)!.number),
            number: a.number,
            title: a.title,
            dueDate: a.dueDate,
            status: a.status,
            completedAt: iso(a.completedAt),
            verifiedAt: iso(a.verifiedAt),
          })),
        },
      };
    }

    const pretasks = pretaskOk
      ? await (async () => {
          const found = await scope.tx
            .select()
            .from(pretaskPlans)
            .where(
              and(
                eq(pretaskPlans.projectId, projectId),
                isNull(pretaskPlans.deletedAt),
                between(pretaskPlans.workDate, range.from, range.to),
              ),
            )
            .orderBy(asc(pretaskPlans.workDate), asc(pretaskPlans.number))
            .limit(LIMIT + 1);
          const kept = found.slice(0, LIMIT);
          const crew = kept.length
            ? await scope.tx
                .select({
                  planId: pretaskCrew.planId,
                  total: sql<number>`count(*)::int`,
                  signed: sql<number>`count(${pretaskCrew.signedAt})::int`,
                  notInducted: sql<number>`count(*) filter (where ${pretaskCrew.inductionStatus} is not null and ${pretaskCrew.inductionStatus} not in ('current', 'unknown'))::int`,
                })
                .from(pretaskCrew)
                .where(
                  inArray(
                    pretaskCrew.planId,
                    kept.map((p) => p.id),
                  ),
                )
                .groupBy(pretaskCrew.planId)
            : [];
          const tally = new Map(crew.map((c) => [c.planId, c]));
          return {
            restricted: false,
            truncated: found.length > LIMIT,
            rows: kept.map((p) => ({
              ref: pretaskLabel(p.number),
              taskTitle: p.taskTitle,
              workDate: p.workDate,
              location: p.location,
              supervisorName: p.supervisorName,
              status: p.status,
              hazards: p.hazards.length,
              hazardsWithoutControls: p.hazards.filter((h) => !h.controls.trim()).length,
              crew: tally.get(p.id)?.total ?? 0,
              signed: tally.get(p.id)?.signed ?? 0,
              notCurrentlyInducted: tally.get(p.id)?.notInducted ?? 0,
              reviewed: p.reviewedAt !== null,
            })),
          };
        })()
      : none;

    const toolbox = toolboxOk
      ? await (async () => {
          const found = await scope.tx
            .select()
            .from(toolboxTalks)
            .where(
              and(
                eq(toolboxTalks.projectId, projectId),
                isNull(toolboxTalks.deletedAt),
                between(toolboxTalks.heldAt, start, end),
              ),
            )
            .orderBy(asc(toolboxTalks.heldAt))
            .limit(LIMIT + 1);
          const kept = found.slice(0, LIMIT);
          const att = kept.length
            ? await scope.tx
                .select({
                  talkId: toolboxAttendees.talkId,
                  total: sql<number>`count(*)::int`,
                  signed: sql<number>`count(${toolboxAttendees.signedAt})::int`,
                })
                .from(toolboxAttendees)
                .where(
                  inArray(
                    toolboxAttendees.talkId,
                    kept.map((t) => t.id),
                  ),
                )
                .groupBy(toolboxAttendees.talkId)
            : [];
          const tally = new Map(att.map((a) => [a.talkId, a]));
          return {
            restricted: false,
            truncated: found.length > LIMIT,
            rows: kept.map((t) => ({
              ref: toolboxLabel(t.number),
              title: t.title,
              heldOn: localDateOf(t.heldAt, timezone),
              presenterName: t.presenterName,
              status: t.status,
              attendees: tally.get(t.id)?.total ?? 0,
              signed: tally.get(t.id)?.signed ?? 0,
            })),
          };
        })()
      : none;

    return { incidents: incidentSection, actions: actionSection, pretasks, toolbox };
  }

  return { evidenceRecords };
}
