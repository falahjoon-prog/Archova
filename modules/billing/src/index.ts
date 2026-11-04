// Public interface of @archova/mod-billing.
import { defineModule, type KernelServices } from '@archova/kernel';
import { billingRoutes } from './api/routes';
import { createCatalogueService, type CatalogueService } from './application/catalogue';
import { createAccountService, type AccountService } from './application/accounts';
import { createDbEntitlementProvider, type EntitlementProvider } from './application/entitlements';

export { TRIAL_ENTITLEMENTS, type EntitlementProvider } from './application/entitlements';
export {
  createAccountService,
  DEFAULT_TRIAL_DAYS,
  MAX_TRIAL_EXTENSION_DAYS,
  MAX_TRIAL_TOTAL_DAYS,
  type AccountSeed,
  type AccountService,
  type OrgAccount,
} from './application/accounts';
export {
  INCREASE_NOTICE_DAYS,
  diffBooks,
  type CatalogueService,
  type PublicPriceBook,
} from './application/catalogue';

export function createBillingModule(
  services: Pick<KernelServices, 'database'>,
  opts: { entitlements?: EntitlementProvider } = {},
) {
  const catalogue = createCatalogueService(services);
  return {
    definition: defineModule({ name: 'billing' }),
    routes: billingRoutes(catalogue),
    api: {
      entitlements: opts.entitlements ?? createDbEntitlementProvider(services),
      /** Org account commands (trial, plan, suspension). Called by `backoffice` after its role rules pass. */
      accounts: createAccountService() as AccountService,
      /** Plans and price books. Called by `backoffice` after its approval rules pass; never by customer routes. */
      catalogue: catalogue as CatalogueService,
    },
  };
}
