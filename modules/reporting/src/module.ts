import { defineModule, type Database } from '@archova/kernel';
import { reportingRoutes } from './api/routes';
import { createPortfolioService } from './application/portfolio';
import { createReportsService } from './application/reports';
import type { ReportingDeps } from './application/sources';
import { REPORTING_PERMISSIONS } from './permissions';

/**
 * Reporting: the portfolio dashboard (open and overdue RFIs, defects and submittals per project) and the report
 * builder (saved definitions run live). Both read the tool modules through their public interfaces, so every number
 * and row is limited to what the person asking may open on that project.
 */
export function createReportingModule(deps: ReportingDeps & { database: Database }) {
  const portfolio = createPortfolioService(deps);
  const reports = createReportsService(deps);
  return {
    definition: defineModule({ name: 'reporting', permissions: REPORTING_PERMISSIONS }),
    routes: reportingRoutes(deps.database, portfolio, reports),
    api: {},
  };
}

export type ReportingModule = ReturnType<typeof createReportingModule>;
