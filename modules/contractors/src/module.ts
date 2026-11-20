import { defineModule, type KernelServices } from '@archova/kernel';
import { contractorsRoutes } from './api/routes';
import { createContractorService } from './application/contractors';
import { createSearchGuard } from './application/search-guard';

export interface ContractorsDeps {
  /** True when the account's email is verified (identity). */
  emailVerified: (userId: string) => Promise<boolean>;
  /** Off until email verification ships; see ContractorDeps. */
  requireVerifiedEmail?: boolean;
  now?: () => Date;
}

/** Free contractor tier (X64): contractor accounts, company search and add, company accept/reject/block. */
export function createContractorsModule(services: KernelServices, deps: ContractorsDeps) {
  const now = deps.now ?? (() => new Date());
  const service = createContractorService(services.database, {
    searchGuard: createSearchGuard({ redis: services.redis, logger: services.logger, now }),
    emailVerified: deps.emailVerified,
    requireVerifiedEmail: deps.requireVerifiedEmail ?? false,
    now,
  });
  return {
    definition: defineModule({ name: 'contractors', permissions: [] }),
    routes: contractorsRoutes(services.database, service),
  };
}

export type ContractorsModule = ReturnType<typeof createContractorsModule>;
