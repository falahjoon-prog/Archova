// Nova contract review against the ai module's endpoints (design/09, PR #189 and the decisions slice).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';

type S = components['schemas'];
export type ContractReview = S['NovaContractReview'];
export type ContractType = S['ContractType'];
export type FlagDecisionKind = S['ContractFlagDecisionKind'];
export type ReviewFlag = ContractReview['flags'][number];
export type FlagDecision = ContractReview['decisions'][number];
export type ContractAnswer = S['NovaContractAnswer'];
export type OurSide = 'we_pay' | 'we_get_paid';
export type BaseForm = 'as4000' | 'as2124' | 'as4902' | 'as4903' | 'other';

export interface StartReviewInput {
  file: File;
  contractType: ContractType;
  ourSide: OurSide;
  baseForm: BaseForm | null;
  multiState: boolean;
}

const P = '/v1/orgs/{orgId}/projects/{projectId}/ai/contract-reviews' as const;

export function createContractReviewApi(orgId: string) {
  return {
    async list(projectId: string): Promise<ContractReview[]> {
      return unwrap(await api.GET(P, { params: { path: { orgId, projectId } } })).data;
    },
    async get(projectId: string, suggestionId: string): Promise<ContractReview> {
      return unwrap(
        await api.GET(`${P}/{suggestionId}`, {
          params: { path: { orgId, projectId, suggestionId } },
        }),
      );
    },
    /** Uploads the PDF to the project (it is scanned for malware first), then asks Nova to read it. */
    async start(projectId: string, input: StartReviewInput): Promise<ContractReview> {
      await ensureCsrfToken();
      const stored = await uploadFile(orgId, { file: input.file, projectId, module: 'documents' });
      return unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId } },
          body: {
            fileId: stored.id,
            contractType: input.contractType,
            ourSide: input.ourSide,
            baseForm: input.baseForm,
            multiState: input.multiState,
          },
        }),
      );
    },
    /** One question about the reviewed contract. The server keeps no conversation. */
    async ask(projectId: string, suggestionId: string, question: string): Promise<ContractAnswer> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{suggestionId}/questions`, {
          params: { path: { orgId, projectId, suggestionId } },
          body: { question },
        }),
      );
    },
    /** Thumbs up or down on an answer (`PUT {o}/ai/runs/{runId}/feedback`). */
    async rate(runId: string, rating: 'up' | 'down'): Promise<void> {
      await ensureCsrfToken();
      unwrap(
        await api.PUT('/v1/orgs/{orgId}/ai/runs/{runId}/feedback', {
          params: { path: { orgId, runId } },
          body: { rating },
        }),
      );
    },
    async decide(
      projectId: string,
      suggestionId: string,
      flagIndex: number,
      body: { decision: FlagDecisionKind; note: string | null },
    ): Promise<ContractReview> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{suggestionId}/flags/{flagIndex}/decision`, {
          params: { path: { orgId, projectId, suggestionId, flagIndex: String(flagIndex) } },
          body,
        }),
      );
    },
  };
}
