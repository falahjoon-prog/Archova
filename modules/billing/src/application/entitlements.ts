import { and, eq } from 'drizzle-orm';
import { CORE_MODULES } from '@archova/domain';
import type { Entitlements, KernelServices } from '@archova/kernel';
import { orgAccounts, planVersions } from '../infra/tables';

/**
 * What an org with no account row gets: a trial with the core modules and the phase 1 feature modules, no limits
 * enforced. Orgs that staff have moved to a plan are read from `billing.org_accounts` (see `dbEntitlementProvider`).
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
    'workforce',
    'estimating',
    // Nova is on every plan with a monthly credit allowance (X27); null = unlimited during the trial.
    'ai',
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

/**
 * Entitlements from the org's account row and the published plan version: the plan's modules on top of the core
 * ones, the plan's Nova allowance, and `read_only` while the company is suspended. No row means a trial.
 */
export function createDbEntitlementProvider(
  services: Pick<KernelServices, 'database'>,
): EntitlementProvider {
  return {
    async forOrg(orgId) {
      const found = await services.database.withGlobalTx('billing', async (tx) => {
        const [acct] = await tx.select().from(orgAccounts).where(eq(orgAccounts.id, orgId));
        if (!acct) return null;
        const [plan] =
          acct.planCode === 'trial'
            ? []
            : await tx
                .select({
                  modules: planVersions.modules,
                  aiCreditsMonthly: planVersions.aiCreditsMonthly,
                })
                .from(planVersions)
                .where(
                  and(
                    eq(planVersions.planCode, acct.planCode),
                    eq(planVersions.status, 'published'),
                  ),
                );
        return { acct, plan };
      });
      if (!found) return TRIAL_ENTITLEMENTS;
      const { acct, plan } = found;
      const modules = plan
        ? [...CORE_MODULES, 'billing', ...plan.modules]
        : TRIAL_ENTITLEMENTS.modules;
      return {
        plan: acct.planCode,
        state: acct.suspendedAt ? 'read_only' : acct.state,
        modules,
        limits: {
          ...TRIAL_ENTITLEMENTS.limits,
          'limit.ai_credits': plan ? plan.aiCreditsMonthly : null,
        },
      };
    },
  };
}
