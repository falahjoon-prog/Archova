// Project home insights (`reporting`) and Nova's read-only follow-up (`ai`).
import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type ProjectInsights = S['ProjectInsights'];
export type ProjectInsight = S['ProjectInsight'];
export type InsightKind = S['InsightKind'];
export type InsightDiscussion = S['InsightDiscussion'];
export interface InsightTurn {
  role: 'user' | 'nova';
  text: string;
}

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;

export function createInsightsApi(orgId: string) {
  return {
    async insights(projectId: string): Promise<ProjectInsights> {
      return unwrap(await api.GET(`${P}/insights`, { params: { path: { orgId, projectId } } }));
    },
    async discuss(
      projectId: string,
      body: { question: string; insightId?: InsightKind; history: InsightTurn[] },
    ): Promise<InsightDiscussion> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/insights/discuss`, {
          params: { path: { orgId, projectId } },
          body,
        }),
      );
    },
  };
}
