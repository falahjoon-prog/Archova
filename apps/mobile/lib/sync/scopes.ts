// What this device keeps offline: the organisation's shared data and, for every project the user can see, the
// modules the app works on. A per-project "keep offline" choice (mobile 02 §2.3) narrows this later.

import { unwrap, type ApiClient } from '@archova/api-client';
import { ORG_SCOPE, projectScope, type SyncScope } from '@archova/sync-core';

/** Modules the phone app reads and writes offline. */
export const OFFLINE_MODULES = ['defects', 'diary', 'photos'] as const;

export async function deviceScopes(api: ApiClient, orgId: string): Promise<SyncScope[]> {
  const projects = unwrap(
    await api.GET('/v1/orgs/{orgId}/projects', {
      params: { path: { orgId }, query: { limit: 200 } },
    }),
  );
  return [
    ORG_SCOPE,
    ...projects.data.flatMap((p) => OFFLINE_MODULES.map((m) => projectScope(p.id, m))),
  ];
}
