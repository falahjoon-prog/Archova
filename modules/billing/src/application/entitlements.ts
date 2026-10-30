import { and, desc, eq, inArray } from 'drizzle-orm';
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
    // Public API access (integrations/06): personal access tokens. A paid plan includes it from Business up.
    'api',
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
        if (acct.planCode === 'trial') return { acct, plan: null };
        const pick = {
          modules: planVersions.modules,
          aiCreditsMonthly: planVersions.aiCreditsMonthly,
        };
        // The published version; if the plan was retired from sale, its latest version, so a company
        // already on it keeps what it bought. A plan with no version at all gets nothing (fails closed).
        const [plan] = await tx
          .select(pick)
          .from(planVersions)
          .where(
            and(
              eq(planVersions.planCode, acct.planCode),
              inArray(planVersions.status, ['published', 'retired']),
            ),
          )
          .orderBy(desc(planVersions.version))
          .limit(1);
        return { acct, plan };
      });
      if (!found) return TRIAL_ENTITLEMENTS;
      const { acct, plan } = found;
      if (acct.planCode === 'trial')
        return {
          ...TRIAL_ENTITLEMENTS,
          state: acct.suspendedAt ? 'read_only' : acct.state,
        };
      // A plan with no version: core modules only, read-only, no Nova, until staff fix the plan.
      if (!plan)
        return {
          plan: acct.planCode,
          state: 'read_only',
          modules: [...CORE_MODULES, 'billing'],
          limits: { ...TRIAL_ENTITLEMENTS.limits, 'limit.ai_credits': 0 },
        };
      return {
        plan: acct.planCode,
        state: acct.suspendedAt ? 'read_only' : acct.state,
        modules: [...CORE_MODULES, 'billing', ...plan.modules],
        limits: { ...TRIAL_ENTITLEMENTS.limits, 'limit.ai_credits': plan.aiCreditsMonthly },
      };
    },
  };
}
