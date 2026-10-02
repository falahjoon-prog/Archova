// Public interface of @archova/mod-billing.
import { defineModule } from '@archova/kernel';
import { billingRoutes } from './api/routes';
import { trialEntitlementProvider, type EntitlementProvider } from './application/entitlements';

export { TRIAL_ENTITLEMENTS, type EntitlementProvider } from './application/entitlements';

export function createBillingModule(opts: { entitlements?: EntitlementProvider } = {}) {
  return {
    definition: defineModule({ name: 'billing' }),
    routes: billingRoutes(),
    api: { entitlements: opts.entitlements ?? trialEntitlementProvider },
  };
}
