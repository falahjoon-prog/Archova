// The org's Nova contract playbook against the ai module (design/09 CR4). Org admins only.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type ContractType = S['ContractType'];
export type PlaybookTopic = S['ContractPlaybookTopic'];
export type Severity = PlaybookTopic['severity'];

const P = '/v1/orgs/{orgId}/ai/contract-playbooks/{contractType}' as const;

export function createContractPlaybookApi(orgId: string) {
  return {
    async get(contractType: ContractType): Promise<PlaybookTopic[]> {
      return unwrap(await api.GET(P, { params: { path: { orgId, contractType } } })).topics;
    },
    /** Replaces the whole playbook for one contract type with the topics shown. */
    async replace(contractType: ContractType, topics: PlaybookTopic[]): Promise<PlaybookTopic[]> {
      await ensureCsrfToken();
      return unwrap(
        await api.PUT(P, { params: { path: { orgId, contractType } }, body: { topics } }),
      ).topics;
    },
  };
}
