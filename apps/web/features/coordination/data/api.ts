import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type BimModel = components['schemas']['BimModel'];
export type CoordinationIssue = components['schemas']['CoordinationIssue'];
export type CoordinationIssueDetail = components['schemas']['CoordinationIssueDetail'];
export type CoordinationIssueStatus = components['schemas']['CoordinationIssueStatus'];
export type CoordinationIssuePriority = components['schemas']['CoordinationIssuePriority'];
export type BimDiscipline = components['schemas']['BimDiscipline'];
export type NewIssue = components['schemas']['CreateCoordinationIssueRequest'];
export type IssueChanges = components['schemas']['UpdateCoordinationIssueRequest'];
export type NewModel = components['schemas']['CreateBimModelRequest'];

const M = '/v1/orgs/{orgId}/projects/{projectId}/bim-models' as const;
const L = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues' as const;
const I = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues/{issueId}' as const;
const C = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues/{issueId}/comments' as const;

/** Live API only: coordination has no preview store. */
export function createCoordinationApi(orgId: string) {
  return {
    async listModels(projectId: string): Promise<BimModel[]> {
      return unwrap(await api.GET(M, { params: { path: { orgId, projectId } } })).data;
    },
    async createModel(projectId: string, body: NewModel): Promise<BimModel> {
      return unwrap(
        await api.POST(M, {
          params: {
            path: { orgId, projectId },
            header: { 'Idempotency-Key': crypto.randomUUID() },
          },
          body,
        }),
      );
    },
    async listIssues(
      projectId: string,
      q: { status?: CoordinationIssueStatus; modelId?: string; q?: string },
    ): Promise<CoordinationIssue[]> {
      return unwrap(await api.GET(L, { params: { path: { orgId, projectId }, query: q } })).data;
    },
    async getIssue(projectId: string, issueId: string): Promise<CoordinationIssueDetail> {
      return unwrap(await api.GET(I, { params: { path: { orgId, projectId, issueId } } }));
    },
    async createIssue(projectId: string, body: NewIssue): Promise<CoordinationIssueDetail> {
      return unwrap(
        await api.POST(L, {
          params: {
            path: { orgId, projectId },
            header: { 'Idempotency-Key': crypto.randomUUID() },
          },
          body,
        }),
      );
    },
    /** `version` is the issue's version as last read; a stale one is refused. */
    async updateIssue(
      projectId: string,
      issueId: string,
      version: number,
      body: IssueChanges,
    ): Promise<CoordinationIssueDetail> {
      return unwrap(
        await api.PATCH(I, {
          params: { path: { orgId, projectId, issueId }, header: { 'If-Match': `"${version}"` } },
          body,
        }),
      );
    },
    async addComment(
      projectId: string,
      issueId: string,
      body: string,
    ): Promise<CoordinationIssueDetail> {
      return unwrap(
        await api.POST(C, { params: { path: { orgId, projectId, issueId } }, body: { body } }),
      );
    },
  };
}
