import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type PermissionTemplate = components['schemas']['PermissionTemplate'];

export function createPermissionTemplatesApi(orgId: string) {
  return {
    async list(): Promise<PermissionTemplate[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/permission-templates', { params: { path: { orgId } } }),
      ).data;
    },
  };
}
