import { and, eq, gte, inArray, isNull, isNotNull } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { AppError, type TenantScope } from '@archova/kernel';
import {
  buildScorecard,
  riskFlag,
  type Scorecard,
  type ScorecardInputs,
} from '../domain/scorecard';
import { incidentActions, incidentPeople, incidents, pretaskCrew, swms } from '../infra/tables';
import type { SafetyDeps } from './swms';

export interface CompanyScorecard {
  companyId: string;
  name: string;
  scorecard: Scorecard;
  riskFlag: string | null;
}

const DAY = 86_400_000;

/**
 * Safety scorecards for the companies on a project. The history is the company's whole record across the org's
 * projects, so a sub's other jobs count before they are re-engaged. Builder staff only: `safety.scorecards.read`.
 */
export function createScorecardService(deps: SafetyDeps) {
  const now = deps.now ?? (() => new Date());

  async function compute(
    scope: TenantScope,
    companyIds: string[],
    today: string,
  ): Promise<Map<string, Scorecard>> {
    const at = now();
    const since = new Date(at.getTime() - 365 * DAY);
    const out = new Map<string, Scorecard>();
    if (companyIds.length === 0) return out;

    const people = await scope.tx
      .select({
        incidentId: incidents.id,
        projectId: incidents.projectId,
        companyId: incidentPeople.companyId,
        role: incidentPeople.role,
        occurredAt: incidents.occurredAt,
        severity: incidents.severity,
        isNotifiable: incidents.isNotifiable,
      })
      .from(incidentPeople)
      .innerJoin(incidents, eq(incidents.id, incidentPeople.incidentId))
      .where(
        and(
          inArray(incidentPeople.companyId, companyIds),
          // A witness is not counted against their company.
          inArray(incidentPeople.role, ['injured', 'involved']),
          isNull(incidents.deletedAt),
          gte(incidents.occurredAt, since),
        ),
      );
    const actions = await scope.tx
      .select({
        companyId: incidentActions.assigneeCompanyId,
        status: incidentActions.status,
        dueDate: incidentActions.dueDate,
      })
      .from(incidentActions)
      .where(inArray(incidentActions.assigneeCompanyId, companyIds));
    const sw = await scope.tx
      .select({ companyId: swms.companyId, status: swms.status, expiresOn: swms.expiresOn })
      .from(swms)
      .where(and(inArray(swms.companyId, companyIds), isNull(swms.deletedAt)));
    const crew = await scope.tx
      .select({ companyId: pretaskCrew.companyId, induction: pretaskCrew.inductionStatus })
      .from(pretaskCrew)
      .where(
        and(
          inArray(pretaskCrew.companyId, companyIds),
          isNotNull(pretaskCrew.signedAt),
          gte(pretaskCrew.signedAt, since),
        ),
      );
    const findings = deps.findings
      ? await deps.findings.safetyByCompany(scope, companyIds, since, today)
      : new Map<string, { raised: number; overdueOpen: number }>();

    for (const id of companyIds) {
      // One row per person in an incident; the company is counted once per incident.
      const byIncident = new Map<string, ScorecardInputs['incidents'][number]>();
      for (const p of people) {
        if (p.companyId !== id) continue;
        const prev = byIncident.get(p.incidentId);
        byIncident.set(p.incidentId, {
          occurredAt: p.occurredAt,
          severity: p.severity,
          isNotifiable: p.isNotifiable,
          projectId: p.projectId,
          injured: p.role === 'injured' || (prev?.injured ?? false),
        });
      }
      const mine = actions.filter((a) => a.companyId === id);
      const sws = sw.filter((s) => s.companyId === id);
      const crews = crew.filter((c) => c.companyId === id && c.induction !== null);
      const f = findings.get(id) ?? { raised: 0, overdueOpen: 0 };
      out.set(
        id,
        buildScorecard(
          {
            incidents: [...byIncident.values()],
            actions: {
              total: mine.length,
              overdueOpen: mine.filter(
                (a) => a.status === 'open' && a.dueDate !== null && a.dueDate < today,
              ).length,
            },
            swms: {
              total: sws.length,
              rejected: sws.filter((s) => s.status === 'rejected').length,
              expired: sws.filter(
                (s) => s.status === 'accepted' && s.expiresOn !== null && s.expiresOn < today,
              ).length,
            },
            inductions: {
              signed: crews.length,
              notCurrent: crews.filter(
                (c) => c.induction !== 'current' && c.induction !== 'unknown',
              ).length,
            },
            findings: f,
          },
          at,
        ),
      );
    }
    return out;
  }

  async function guard(scope: TenantScope, projectId: string) {
    const ok = await deps.access.can(scope, 'safety.scorecards.read', { projectId });
    if (!ok)
      throw new AppError('access.denied', "You can't see safety scorecards on this project.");
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  /** Every company on the project, worst score first. */
  async function list(scope: TenantScope, projectId: string): Promise<CompanyScorecard[]> {
    const today = await guard(scope, projectId);
    const companies = await deps.platform.projectCompanies(scope, projectId);
    const cards = await compute(
      scope,
      companies.map((c) => c.id),
      today,
    );
    return companies
      .map((c) => {
        const scorecard = cards.get(c.id)!;
        return { companyId: c.id, name: c.name, scorecard, riskFlag: riskFlag(c.name, scorecard) };
      })
      .sort((a, b) => a.scorecard.score - b.scorecard.score || a.name.localeCompare(b.name));
  }

  /** Companies on the project that Nova should raise, for the `subcontractor_safety_risk` tool. */
  async function atRisk(scope: TenantScope, projectId: string) {
    try {
      const all = await list(scope, projectId);
      return { restricted: false, rows: all.filter((c) => c.riskFlag !== null) };
    } catch (e) {
      if (e instanceof AppError && e.code === 'access.denied')
        return { restricted: true, rows: [] };
      throw e;
    }
  }

  return { list, atRisk };
}

export type ScorecardService = ReturnType<typeof createScorecardService>;
