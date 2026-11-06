import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type { AnalyticsFilters, IncidentAnalytics } from '../lib/types';

export function createIncidentAnalyticsApi(orgId: string) {
  return {
    async get(f: AnalyticsFilters): Promise<IncidentAnalytics> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/incident-analytics', {
          params: {
            path: { orgId },
            query: {
              ...(f.projectId ? { projectId: f.projectId } : {}),
              ...(f.companyId ? { companyId: f.companyId } : {}),
              ...(f.bodyPart ? { bodyPart: f.bodyPart as never } : {}),
              ...(f.from ? { from: f.from } : {}),
              ...(f.to ? { to: f.to } : {}),
            },
          },
        }),
      );
    },
  };
}
