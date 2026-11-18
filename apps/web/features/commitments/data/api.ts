// Subcontracts and purchase orders against the project budget (financials commitments endpoints).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Commitment = S['Commitment'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;

export function createCommitmentsApi(orgId: string) {
  return {
    async list(projectId: string): Promise<Commitment[]> {
      return unwrap(await api.GET(`${P}/commitments`, { params: { path: { orgId, projectId } } }))
        .data;
    },
  };
}
