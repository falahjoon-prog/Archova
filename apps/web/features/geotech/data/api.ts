import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type { GeotechSource } from './source';

const P = '/v1/orgs/{orgId}/projects/{projectId}/geotech' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** The live source. Reads the first 100 rows of each list; the API filters. */
export function createGeotechApi(orgId: string): GeotechSource {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async investigations(projectId) {
      return unwrap(
        await api.GET(`${P}/investigations`, {
          params: { path: path(projectId), query: { limit: 100 } },
        }),
      ).data;
    },
    async createInvestigation(projectId, input) {
      return unwrap(
        await api.POST(`${P}/investigations`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body: input,
        }),
      );
    },
    async tests(projectId, f) {
      return unwrap(
        await api.GET(`${P}/tests`, {
          params: { path: path(projectId), query: { result: f.result, limit: 100 } },
        }),
      ).data;
    },
    async createTest(projectId, input) {
      return unwrap(
        await api.POST(`${P}/tests`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body: input,
        }),
      );
    },
    async deleteTest(projectId, id) {
      unwrap(
        await api.DELETE(`${P}/tests/{testId}`, {
          params: { path: { ...path(projectId), testId: id } },
        }),
      );
    },
    async earthworks(projectId) {
      return unwrap(
        await api.GET(`${P}/earthworks`, {
          params: { path: path(projectId), query: { limit: 100 } },
        }),
      ).data;
    },
    async createEarthworks(projectId, input) {
      return unwrap(
        await api.POST(`${P}/earthworks`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body: input,
        }),
      );
    },
    async deleteEarthworks(projectId, id) {
      unwrap(
        await api.DELETE(`${P}/earthworks/{entryId}`, {
          params: { path: { ...path(projectId), entryId: id } },
        }),
      );
    },
    async summary(projectId) {
      return unwrap(
        await api.GET(`${P}/earthworks/summary`, { params: { path: path(projectId) } }),
      );
    },
    async flags(projectId) {
      return unwrap(await api.GET(`${P}/flags`, { params: { path: path(projectId) } })).data;
    },
  };
}
