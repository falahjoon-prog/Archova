// The integrations catalogue (integrations/06 §4).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type CatalogueEntry = S['IntegrationCatalogueEntry'];

export function createMarketplaceApi(orgId: string) {
  return {
    async catalogue(): Promise<CatalogueEntry[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/integrations/catalogue', { params: { path: { orgId } } }),
      ).data;
    },
  };
}
