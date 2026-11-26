import { buildRegistry, FOUNDATION_PERMISSIONS } from '@archova/domain/permissions';
import { createAccessService } from '@archova/mod-access';
import { FINANCIALS_PERMISSIONS, postPlantCost } from '@archova/mod-financials';
import { PLANT_PERMISSIONS, PLANT_TIME_ZONE, postHireCosts } from '@archova/mod-plant';
import { lookupProjectMembership } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Permission checks the way the API makes them, so the job asks the same question the allocation did. Only the keys
 * this job checks are registered: `@archova/compose` would pull every module (pdf.js, argon2) into the worker image.
 */
const access = createAccessService({
  registry: buildRegistry(FOUNDATION_PERMISSIONS, PLANT_PERMISSIONS, FINANCIALS_PERMISSIONS),
  lookupProjectMember: lookupProjectMembership,
});

/**
 * Plant hire cost to the project budget: once a day, the finished days of hired machines' allocations that carry a
 * cost code are posted as a direct cost on the project's budget line for that code, authored by whoever allocated
 * the machine, and only while they can still manage direct costs on that project. A month's hire is posted after
 * month end; an allocation that has ended is posted in full. Idempotent: days already posted are never posted again,
 * and an allocation whose project has no budget line yet waits until it has one. Orgs carry no time zone yet, so
 * the plant calendar day is Sydney's.
 */
export const plantHireCosts: TenantJob = {
  name: 'plant.hire-costs',
  cron: '30 19 * * *',
  run: (database, orgId, now) =>
    database.withTenantTx(jobContext(orgId, `plant.hire-costs:${orgId}`), (scope) =>
      postHireCosts(scope, localDateOf(now, PLANT_TIME_ZONE), postPlantCost, access),
    ),
};
