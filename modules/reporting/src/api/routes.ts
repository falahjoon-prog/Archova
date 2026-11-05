import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { PortfolioService } from '../application/portfolio';
import type { RiskService } from '../application/risk';
import type { ReadinessService } from '../application/readiness';
import type { ReportsService } from '../application/reports';

export function reportingRoutes(
  database: Database,
  portfolio: PortfolioService,
  reports: ReportsService,
  risk: RiskService,
  readiness: ReadinessService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const id = (p: { reportId: string }) => {
    const v = decodeId('report', p.reportId);
    if (!v) throw new AppError('report.not_found');
    return v;
  };

  return defineRoutes({
    getPortfolio: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        portfolio.get(s, { includeClosed: input.query?.includeClosed === 'true' }),
      ),
    }),
    getLateSopaClaimRisk: async (input) => ({
      status: 200,
      // A write transaction: reading a subbie's wallet is recorded in the subbie's access log.
      body: await tx(input, (s) =>
        risk.lateSopaClaims(s, { includeClosed: input.query?.includeClosed === 'true' }),
      ),
    }),
    getReadinessPack: async (input) => ({
      status: 200,
      body: await read(input, (s) => readiness.build(s)),
    }),
    getReadinessPackPdf: async (input) => ({
      status: 200,
      body: await read(input, (s) => readiness.pdf(s)),
    }),
    listReports: async (input) => ({
      status: 200,
      body: await read(input, (s) => reports.list(s)),
    }),
    createReport: async (input) => ({
      status: 201,
      body: await tx(input, (s) => reports.create(s, input.body)),
    }),
    previewReport: async (input) => ({
      status: 200,
      body: await read(input, (s) => reports.preview(s, input.body)),
    }),
    getReport: async (input) => ({
      status: 200,
      body: await read(input, (s) => reports.get(s, id(input.params))),
    }),
    updateReport: async (input) => ({
      status: 200,
      body: await tx(input, (s) => reports.update(s, id(input.params), input.body)),
    }),
    deleteReport: async (input) => {
      await tx(input, (s) => reports.remove(s, id(input.params)));
      return { status: 204 };
    },
    runReport: async (input) => ({
      status: 200,
      body: await read(input, (s) => reports.runSaved(s, id(input.params))),
    }),
  });
}
