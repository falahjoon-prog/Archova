import { defineModule, type KernelServices } from '@archova/kernel';
import { createStatementService, type DeclarationsDeps } from './application/statements';
import { declarationsRoutes } from './api/routes';
import { DECLARATIONS_PERMISSIONS } from './permissions';

export type { DeclarationsDeps, OpenClaim, ClaimGate } from './application/statements';

export function createDeclarationsModule(services: KernelServices, deps: DeclarationsDeps) {
  const statements = createStatementService(deps);
  return {
    definition: defineModule({ name: 'declarations', permissions: DECLARATIONS_PERMISSIONS }),
    routes: declarationsRoutes(services.database, statements),
    api: {
      /** For `financials` when a payment schedule is issued: where a subcontract claim stands on the declarations. */
      claimGate: statements.claimGate,
      /** For `financials`: the acknowledgement on the record when money is scheduled with a declaration missing. */
      recordOverride: statements.recordOverride,
      /** For Nova (`/ai/assist`): rule-based attention flags for a project. */
      flags: statements.flags,
    },
  };
}

export type DeclarationsModule = ReturnType<typeof createDeclarationsModule>;
export type DeclarationsApi = DeclarationsModule['api'];
