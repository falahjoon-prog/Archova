import { unwrap } from '@archova/api-client';
import { api } from './api';
import { allPages } from './data-mode';

// Names for the user ids the API returns (createdBy, ownerId). Payloads keep ids so synced data never holds a stale
// name; screens resolve them against the project's members (Ben, 2 Oct 2026: listProjectMembers is the lookup).

export interface ProjectPerson {
  id: string;
  name: string;
  companyId: string;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; members: Promise<ProjectPerson[]> }>();

/**
 * The project's active members, fetched once per project and reused for a few minutes. A caller who can't list
 * members gets an empty list, so screens fall back to "Project member" instead of failing.
 */
export function projectMembers(orgId: string, projectId: string): Promise<ProjectPerson[]> {
  const key = `${orgId}:${projectId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.members;
  const members = allPages(async (cursor) =>
    unwrap(
      await api.GET('/v1/orgs/{orgId}/projects/{projectId}/members', {
        params: { path: { orgId, projectId }, query: { limit: 200, cursor } },
      }),
    ),
  )
    .then((rows) =>
      rows
        .filter((m) => m.status !== 'removed')
        .map((m) => ({ id: m.userId, name: m.name, companyId: m.companyId })),
    )
    .catch(() => {
      cache.delete(key);
      return [] as ProjectPerson[];
    });
  cache.set(key, { at: Date.now(), members });
  return members;
}

/** The project's people by user id. */
export async function projectPeople(
  orgId: string,
  projectId: string,
): Promise<Map<string, string>> {
  return new Map((await projectMembers(orgId, projectId)).map((m) => [m.id, m.name]));
}

/** For tests: forget cached members. */
export function resetProjectPeople() {
  cache.clear();
}
