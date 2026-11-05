import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { fileDownloadUrl, uploadFile } from '@/shared/lib/uploads';

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
    /** Stores an IFC file for a model; resolves with the `fileId` to register it under. */
    async uploadModelFile(projectId: string, file: File): Promise<string> {
      // Browsers leave `.ifc` untyped, and storage only accepts known types, so say what it is.
      const typed = new File([file], file.name, { type: 'model/ifc' });
      return (await uploadFile(orgId, { file: typed, projectId, module: 'bim' })).id;
    },
    /** The bytes of a stored model file, read from a short-lived signed URL. */
    async downloadModelFile(fileId: string): Promise<Uint8Array> {
      const res = await fetch(await fileDownloadUrl(orgId, fileId));
      if (!res.ok) throw new Error(`The model file could not be downloaded (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
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
