import { defineModule, type KernelServices } from '@archova/kernel';
import { contractorsRoutes } from './api/routes';
import { createContractorService } from './application/contractors';

/** Free contractor tier (X64): contractor accounts, company search and add, company accept/reject. */
export function createContractorsModule(services: KernelServices) {
  const service = createContractorService(services.database);
  return {
    definition: defineModule({ name: 'contractors', permissions: [] }),
    routes: contractorsRoutes(services.database, service),
  };
}

export type ContractorsModule = ReturnType<typeof createContractorsModule>;
