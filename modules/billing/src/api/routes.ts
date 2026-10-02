import { defineRoutes, requireTenant } from '@archova/kernel';

export function billingRoutes() {
  return defineRoutes({
    getEntitlements: async (input) => {
      const tenant = requireTenant(input);
      const e = tenant.entitlements;
      return {
        status: 200,
        body: {
          orgId: input.params.orgId,
          plan: e.plan,
          state: e.state,
          modules: [...e.modules],
          limits: { ...e.limits },
        },
      };
    },
  });
}
