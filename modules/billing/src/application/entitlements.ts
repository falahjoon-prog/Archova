import { CORE_MODULES } from '@archova/domain';
import type { Entitlements } from '@archova/kernel';

/**
 * Phase 0 placeholder for the billing module (Sam owns the commercial model: security-licensing/04–06).
 * Every org gets a trial with the core modules and the phase 1 feature modules; no limits enforced yet.
 * Sam replaces this with `billing.entitlements` materialised per org and cached at `t:{org}:ent:{v}`.
 */
export const TRIAL_ENTITLEMENTS: Entitlements = {
  plan: 'trial',
  state: 'trialing',
  modules: [
    ...CORE_MODULES,
    'billing',
    'documents',
    'rfis',
    'submittals',
    'diary',
    'defects',
    'photos',
    'meetings',
    'correspondence',
  ],
  limits: {
    'limit.active_projects': null,
    'limit.seats': null,
    'limit.storage_gb': null,
    'limit.ai_credits': null,
  },
};

export interface EntitlementProvider {
  forOrg(orgId: string): Promise<Entitlements>;
}

export const trialEntitlementProvider: EntitlementProvider = {
  forOrg: async () => TRIAL_ENTITLEMENTS,
};
