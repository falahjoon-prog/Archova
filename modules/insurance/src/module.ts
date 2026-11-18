import { defineModule, type KernelServices } from '@archova/kernel';
import { createCoverService, type InsuranceDeps } from './application/covers';
import { insuranceRoutes } from './api/routes';
import { INSURANCE_PERMISSIONS } from './permissions';

export type { InsuranceDeps } from './application/covers';

export function createInsuranceModule(services: KernelServices, deps: InsuranceDeps) {
  const covers = createCoverService(deps);
  return {
    definition: defineModule({ name: 'insurance', permissions: INSURANCE_PERMISSIONS }),
    routes: insuranceRoutes(services.database, covers),
    api: {
      /** For the site compliance gate: where one company stands on insurance and bonds today. */
      companyClearance: covers.companyClearance,
      /** For Nova (`/ai/assist`): rule-based attention flags for a project. */
      flags: covers.flags,
    },
  };
}

export type InsuranceModule = ReturnType<typeof createInsuranceModule>;
export type InsuranceApi = InsuranceModule['api'];
