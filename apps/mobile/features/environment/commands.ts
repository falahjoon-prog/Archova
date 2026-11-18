// Sustainability on the phone: the summary and the compliance-condition register, online. Starting a condition is the
// one action here; sign-off needs evidence or a note and stays on the web. The server checks the caller's level.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface EnvironmentTarget {
  orgId: string;
  projectId: string;
}

const path = (t: EnvironmentTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function getSummary(api: ApiClient, t: EnvironmentTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/environment/summary', {
      params: { path: path(t) },
    }),
  );
}

export async function listConditions(api: ApiClient, t: EnvironmentTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/environment/conditions', {
      params: { path: path(t), query: { limit: 100 } },
    }),
  ).data;
}

/** Marks a condition as in progress, against the version that was read. */
export async function startCondition(
  api: ApiClient,
  t: EnvironmentTarget,
  condition: { id: string; version: number },
) {
  return unwrap(
    await api.POST(
      '/v1/orgs/{orgId}/projects/{projectId}/environment/conditions/{conditionId}/transition',
      {
        params: {
          path: { ...path(t), conditionId: condition.id },
          header: { 'If-Match': `"${condition.version}"` },
        },
        body: { action: 'start' },
      },
    ),
  );
}
