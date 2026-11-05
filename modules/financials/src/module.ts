import { defineModule, type KernelServices } from '@archova/kernel';
import { budgetRoutes } from './api/budgetRoutes';
import { financialsRoutes } from './api/routes';
import { directCostRoutes } from './api/directCostRoutes';
import { createDirectCostsService } from './application/directCosts';
import { createCommitmentsService } from './application/commitments';
import { createBudgetService } from './application/budget';
import { createForecastService } from './application/forecast';
import { createFinancialsService, type FinancialsDeps } from './application/financials';
import { createRetentionService } from './application/retention';
import { createTrustService } from './application/trust';
import { FINANCIALS_PERMISSIONS } from './permissions';

/**
 * Financials, phase 2 first increment (product/09, backend schema/financials.md): contracts with a schedule of
 * values, payment claims with stored SOPA deadlines, and payment schedules. Variations, retention ledger, service
 * evidence, subcontractor payee view and the lawyer sign-off switch (X61) follow.
 */
export function createFinancialsModule(services: KernelServices, deps: FinancialsDeps) {
  const service = createFinancialsService(deps);
  const forecast = createForecastService(deps);
  const budget = createBudgetService({
    access: deps.access,
    forecastInputs: forecast.inputsByCode,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const commitments = createCommitmentsService({
    access: deps.access,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const directCosts = createDirectCostsService({
    access: deps.access,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const trustDeps = {
    ...deps,
    contractFor: service.contractFor,
    requireStaff: service.requireStaff,
  };
  const trust = createTrustService(trustDeps);
  const retention = createRetentionService(trustDeps, trust);
  return {
    definition: defineModule({ name: 'financials', permissions: FINANCIALS_PERMISSIONS }),
    routes: {
      ...financialsRoutes(services.database, service, forecast, commitments, trust, retention),
      ...budgetRoutes(services.database, budget),
      ...directCostRoutes(services.database, directCosts),
    },
    api: {
      ledgerSource: service.ledgerSource,
      sopaRiskSignals: service.sopaRiskSignals,
      recordPayment: service.recordPayment,
      createContract: service.createContract,
      contractForQuote: service.contractForQuote,
      /** Retention-trust standing of a project's subcontracts, for the tender-readiness pack (`reporting`). */
      trustSummary: trust.trustSummary,
      createCommitment: commitments.createCommitment,
      commitmentForQuote: commitments.commitmentForQuote,
    },
  };
}

export type FinancialsModule = ReturnType<typeof createFinancialsModule>;
