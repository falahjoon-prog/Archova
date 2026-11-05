// What this device keeps offline: the organisation's shared data and, for every project the user can see, the
// modules the app works on. The user can remove a project from the device (mobile 02 §2.8), which narrows this.

import { unwrap, type ApiClient } from '@archova/api-client';
import { ORG_SCOPE, projectScope, type SyncScope } from '@archova/sync-core';

/** Modules the phone app reads and writes offline. */
export const OFFLINE_MODULES = [
  'defects',
  'diary',
  'photos',
  'quality',
  'drawings',
  'safety',
] as const;

export async function deviceScopes(
  api: ApiClient,
  orgId: string,
  /** Projects the user removed from this device; they are not synced. */
  excluded: () => Promise<ReadonlySet<string>> = async () => new Set(),
): Promise<SyncScope[]> {
  const skip = await excluded();
  const projects = unwrap(
    await api.GET('/v1/orgs/{orgId}/projects', {
      params: { path: { orgId }, query: { limit: 200 } },
    }),
  );
  return [
    ORG_SCOPE,
    ...projects.data
      .filter((p) => !skip.has(p.id))
      .flatMap((p) => OFFLINE_MODULES.map((m) => projectScope(p.id, m))),
  ];
}
