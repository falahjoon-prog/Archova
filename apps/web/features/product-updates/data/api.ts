// Product updates written by the Archova owner: the published list is public, so no org is needed.
import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type PublicProductUpdate = components['schemas']['PublicProductUpdates']['items'][number];

export async function listProductUpdates(): Promise<PublicProductUpdate[]> {
  return unwrap(await api.GET('/v1/public/product-updates')).items;
}
