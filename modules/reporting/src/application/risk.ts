import { encodeId } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import type { FinancialsModule } from '@archova/mod-financials';
import type { PlatformApi } from '@archova/mod-platform';
import type { SchedulingModule } from '@archova/mod-scheduling';
import type { WorkforceApi } from '@archova/mod-workforce';
import { localDateOf } from '@archova/time';
import {
  assessClaim,
  assessProject,
  deadlineState,
  orderRisks,
  type ClaimRisk,
  type InsuranceInput,
} from '../domain/risk';
import { visibleProjects, type ReportingDeps } from './sources';

/** What Nova's risk questions read: one narrow, permission-checked signal per module (never raw tables). */
export interface RiskDeps {
  platform: ReportingDeps['platform'] & Pick<PlatformApi, 'getProject' | 'companyLinkedOrgs'>;
  financials: Pick<FinancialsModule['api'], 'sopaRiskSignals'>;
  scheduling: Pick<SchedulingModule['api'], 'slipSignals'>;
  workforce: Pick<WorkforceApi, 'insuranceSignals'>;
  now?: () => Date;
}

type FinClaim = Awaited<ReturnType<RiskDeps['financials']['sopaRiskSignals']>>['claims'][number];

const toInput = (c: FinClaim, subbieName: string | null) => ({
  claimId: c.claimId,
  claimNumber: c.claimNumber,
  contractNumber: c.contractNumber,
  contractTitle: c.contractTitle,
  subbieName,
  scheduleDueOn: c.scheduleDueOn,
  paymentDueOn: c.paymentDueOn,
  claimedTotalCents: c.claimedTotalCents,
});

export function createRiskService(deps: ReportingDeps & RiskDeps) {
  const now = deps.now ?? (() => new Date());

  /** Projects the caller can see with a subcontract claim near or past its payment-schedule deadline, worst first. */
  async function lateSopaClaims(scope: TenantScope, opts: { includeClosed: boolean }) {
    const { projects, truncated } = await visibleProjects(deps, scope, opts);
    const out = [];
    let unreadable = 0;
    for (const p of projects) {
      const fin = await deps.financials.sopaRiskSignals(scope, p.id);
      if (fin.restricted) {
        unreadable++;
        continue;
      }
      if (fin.claims.length === 0) continue;
      const project = await deps.platform.getProject(scope, p.id);
      const today = localDateOf(now(), project.timezone);
      // Only claims near their deadline need the other signals, so the wallet is read only for those.
      const near = fin.claims.filter((c) => deadlineState(c.scheduleDueOn, today) !== null);
      if (near.length === 0) continue;
      const companyIds = [
        ...new Set(near.map((c) => c.payeeCompanyId).filter((x): x is string => !!x)),
      ];
      const companies = await deps.platform.companyLinkedOrgs(scope, companyIds);
      const orgIds = [
        ...new Set(
          [...companies.values()].map((c) => c.linkedOrgId).filter((x): x is string => !!x),
        ),
      ];
      const wallet = await deps.workforce.insuranceSignals(scope, p.id, orgIds);
      const insuranceFor = (companyId: string | null): InsuranceInput => {
        const org = companyId ? companies.get(companyId)?.linkedOrgId : null;
        if (!org || wallet.restricted || wallet.unseen.includes(org))
          return { unseen: true, docs: [] };
        return { unseen: false, docs: wallet.insurances.filter((i) => i.subbieOrgId === org) };
      };
      const claims = near
        .map((c) =>
          assessClaim(
            toInput(c, c.payeeCompanyId ? (companies.get(c.payeeCompanyId)?.name ?? null) : null),
            today,
            insuranceFor(c.payeeCompanyId),
          ),
        )
        .filter((c): c is ClaimRisk => c !== null);
      const slip = await deps.scheduling.slipSignals(scope, p.id);
      const risk = assessProject(claims, slip, false);
      if (!risk) continue;
      out.push({
        name: p.name,
        projectId: encodeId('project', p.id),
        number: p.number,
        ...risk,
        claims: risk.claims.map((c) => ({ ...c, claimId: encodeId('paymentClaim', c.claimId) })),
        slip: {
          lateCount: slip.lateCount,
          worst: slip.worst.map((a) => ({
            id: encodeId('scheduleActivity', a.id),
            wbs: a.wbs,
            name: a.name,
            finish: a.finish,
            daysLate: a.daysLate,
          })),
        },
      });
    }
    return {
      projects: orderRisks(out).map(({ name, ...rest }) => ({ projectName: name, ...rest })),
      unreadableProjects: unreadable,
      truncated,
    };
  }

  return { lateSopaClaims };
}

export type RiskService = ReturnType<typeof createRiskService>;
