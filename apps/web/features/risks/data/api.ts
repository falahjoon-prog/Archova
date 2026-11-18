// The project risk register against the reporting module's endpoints.
import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type ProjectRisk = S['ProjectRisk'];
export type RiskSummary = S['ProjectRiskSummary'];
export type RiskCategory = S['RiskCategory'];
export type RiskStatus = S['RiskStatus'];
export type CreateRisk = S['CreateProjectRiskRequest'];
export type UpdateRisk = S['UpdateProjectRiskRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createRisksApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async list(projectId: string): Promise<ProjectRisk[]> {
      return unwrap(await api.GET(`${P}/risks`, { params: { path: path(projectId), query: {} } }))
        .data;
    },
    async summary(projectId: string): Promise<RiskSummary> {
      return unwrap(await api.GET(`${P}/risks/summary`, { params: { path: path(projectId) } }));
    },
    async create(projectId: string, body: CreateRisk): Promise<ProjectRisk> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/risks`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async update(
      projectId: string,
      risk: { id: string; version: number },
      body: UpdateRisk,
    ): Promise<ProjectRisk> {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/risks/{riskId}`, {
          params: { path: { ...path(projectId), riskId: risk.id }, header: ifMatch(risk.version) },
          body,
        }),
      );
    },
    async remove(projectId: string, riskId: string): Promise<void> {
      await ensureCsrfToken();
      unwrap(
        await api.DELETE(`${P}/risks/{riskId}`, {
          params: { path: { ...path(projectId), riskId } },
        }),
      );
    },
  };
}
