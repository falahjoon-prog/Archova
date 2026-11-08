import { defineModule, type Database } from '@archova/kernel';
import { reportingRoutes } from './api/routes';
import { createAuditService, type AuditDeps } from './application/audit';
import { createSnapshotService, type SnapshotDeps } from './application/snapshots';
import { createPortfolioService } from './application/portfolio';
import { createRiskService, type RiskDeps } from './application/risk';
import { createSustainabilityService } from './application/sustainability';
import { createReadinessService } from './application/readiness';
import { createReportsService } from './application/reports';
import type { ReportingDeps } from './application/sources';
import { REPORTING_PERMISSIONS } from './permissions';

/**
 * Reporting: the portfolio dashboard (open and overdue RFIs, defects and submittals per project) and the report
 * builder (saved definitions run live), and the tender-readiness pack (company licences and insurance, prequalification, safety record and
 * retention-trust standing in one page or PDF). Both read the tool modules through their public interfaces, so every number
 * and row is limited to what the person asking may open on that project.
 */
export function createReportingModule(
  deps: ReportingDeps & RiskDeps & AuditDeps & SnapshotDeps & { database: Database },
) {
  const portfolio = createPortfolioService(deps);
  const reports = createReportsService(deps);
  const risk = createRiskService(deps);
  const readiness = createReadinessService(deps);
  const audit = createAuditService(deps);
  const snapshots = createSnapshotService(deps, portfolio);
  const sustainability = createSustainabilityService(deps);
  return {
    definition: defineModule({ name: 'reporting', permissions: REPORTING_PERMISSIONS }),
    routes: reportingRoutes(
      deps.database,
      portfolio,
      reports,
      risk,
      readiness,
      audit,
      snapshots,
      sustainability,
    ),
    api: {},
  };
}

export type ReportingModule = ReturnType<typeof createReportingModule>;
