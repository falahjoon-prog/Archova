import { defineModule, type KernelServices } from '@archova/kernel';
import { budgetRoutes } from './api/budgetRoutes';
import { financialsRoutes } from './api/routes';
import { createCommitmentsService } from './application/commitments';
import { createBudgetService } from './application/budget';
import { createForecastService } from './application/forecast';
import { createFinancialsService, type FinancialsDeps } from './application/financials';
import { createTrustService } from './application/trust';
import { FINANCIALS_PERMISSIONS } from './permissions';

/**
 * Financials, phase 2 first increment (product/09, backend schema/financials.md): contracts with a schedule of
 * values, payment claims with stored SOPA deadlines, and payment schedules. Variations, retention ledger, service
 * evidence, subcontractor payee view and the lawyer sign-off switch (X61) follow.
 */
export function createFinancialsModule(services: KernelServices, deps: FinancialsDeps) {
  const service = createFinancialsService(deps);
  const budget = createBudgetService({
    access: deps.access,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const commitments = createCommitmentsService({
    access: deps.access,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const forecast = createForecastService(deps);
  const trust = createTrustService({
    ...deps,
    contractFor: service.contractFor,
    requireStaff: service.requireStaff,
  });
  return {
    definition: defineModule({ name: 'financials', permissions: FINANCIALS_PERMISSIONS }),
    routes: {
      ...financialsRoutes(services.database, service, forecast, commitments, trust),
      ...budgetRoutes(services.database, budget),
    },
    api: { ledgerSource: service.ledgerSource, recordPayment: service.recordPayment },
  };
}

export type FinancialsModule = ReturnType<typeof createFinancialsModule>;
