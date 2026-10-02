import { unwrap } from '@archova/api-client';
import { api } from './api';
import { allPages } from './data-mode';

// Names for the user ids the API returns (createdBy, ownerId). Payloads keep ids so synced data never holds a stale
// name; screens resolve them against the project's members (Ben, 2 Oct 2026: listProjectMembers is the lookup).

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; names: Promise<Map<string, string>> }>();

/**
 * The project's people by user id, fetched once per project and reused for a few minutes. A caller who can't list
 * members gets an empty map, so screens fall back to "Project member" instead of failing.
 */
export function projectPeople(orgId: string, projectId: string): Promise<Map<string, string>> {
  const key = `${orgId}:${projectId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  const names = allPages(async (cursor) =>
    unwrap(
      await api.GET('/v1/orgs/{orgId}/projects/{projectId}/members', {
        params: { path: { orgId, projectId }, query: { limit: 200, cursor } },
      }),
    ),
  )
    .then((members) => new Map(members.map((m) => [m.userId, m.name])))
    .catch(() => {
      cache.delete(key);
      return new Map<string, string>();
    });
  cache.set(key, { at: Date.now(), names });
  return names;
}

/** For tests: forget cached members. */
export function resetProjectPeople() {
  cache.clear();
}
