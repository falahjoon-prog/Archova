import { postPlantCost } from '@archova/mod-financials';
import { PLANT_TIME_ZONE, postHireCosts } from '@archova/mod-plant';
import { localDateOf } from '@archova/time';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Plant hire cost to the project budget: once a day, the finished days of hired machines' allocations that carry a
 * cost code are posted as a direct cost on the project's budget line for that code. A month's hire is posted after
 * month end; an allocation that has ended is posted in full. Idempotent: days already posted are never posted again,
 * and an allocation whose project has no budget line yet waits until it has one. Orgs carry no time zone yet, so
 * the plant calendar day is Sydney's.
 */
export const plantHireCosts: TenantJob = {
  name: 'plant.hire-costs',
  cron: '30 19 * * *',
  run: (database, orgId, now) =>
    database.withTenantTx(jobContext(orgId, `plant.hire-costs:${orgId}`), (scope) =>
      postHireCosts(scope, localDateOf(now, PLANT_TIME_ZONE), postPlantCost),
    ),
};
