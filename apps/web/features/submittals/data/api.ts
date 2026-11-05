// Submittals against the submittals module's endpoints (product/04). People and companies come back as ids;
// screens name them from the project directory.

import { unwrap } from '@archova/api-client';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  ReviewAnswer,
  Submittal,
  SubmittalDetail,
  SubmittalFilters,
  SubmittalInput,
} from '../lib/types';

const P = '/v1/orgs/{orgId}/projects/{projectId}/submittals' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export interface SubmittalsSource {
  list(projectId: string, f?: SubmittalFilters): Promise<Submittal[]>;
  get(projectId: string, id: string): Promise<SubmittalDetail>;
  create(projectId: string, input: SubmittalInput): Promise<SubmittalDetail>;
  update(
    projectId: string,
    id: string,
    version: number,
    input: Partial<SubmittalInput>,
  ): Promise<SubmittalDetail>;
  submit(
    projectId: string,
    id: string,
    version: number,
    input: { files: File[]; note: string; reviewerIds?: string[] },
  ): Promise<SubmittalDetail>;
  respond(
    projectId: string,
    id: string,
    stepId: string,
    input: { response: ReviewAnswer; comments: string; files: File[] },
  ): Promise<SubmittalDetail>;
  close(projectId: string, id: string, version: number): Promise<SubmittalDetail>;
}

/** Shown while the screens run on sample data: there is no preview register, so it starts empty. */
export const submittalsPreview: SubmittalsSource = {
  list: async () => [],
  get: async () => {
    throw new Error('Submittals are not available in the sample-data preview.');
  },
  create: async () => {
    throw new Error('Submittals are not available in the sample-data preview.');
  },
  update: async () => {
    throw new Error('Submittals are not available in the sample-data preview.');
  },
  submit: async () => {
    throw new Error('Submittals are not available in the sample-data preview.');
  },
  respond: async () => {
    throw new Error('Submittals are not available in the sample-data preview.');
  },
  close: async () => {
    throw new Error('Submittals are not available in the sample-data preview.');
  },
};

export function createSubmittalsApi(orgId: string): SubmittalsSource {
  const upload = (projectId: string, files: File[]) =>
    Promise.all(
      files.map(
        async (file) => (await uploadFile(orgId, { file, projectId, module: 'submittals' })).id,
      ),
    );
  const path = (projectId: string, submittalId: string) => ({ orgId, projectId, submittalId });

  return {
    list: (projectId, f = {}) =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET(P, {
            params: {
              path: { orgId, projectId },
              query: {
                limit: 200,
                cursor,
                ...(f.status ? { status: f.status } : {}),
                ...(f.type ? { type: f.type } : {}),
                ...(f.ballInCourt ? { ballInCourt: f.ballInCourt } : {}),
                ...(f.q?.trim() ? { q: f.q.trim() } : {}),
              },
            },
          }),
        ),
      ),
    get: async (projectId, id) =>
      unwrap(await api.GET(`${P}/{submittalId}`, { params: { path: path(projectId, id) } })),
    create: async (projectId, input) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: {
            title: input.title,
            type: input.type,
            leadTimeDays: input.leadTimeDays,
            reviewDays: input.reviewDays,
            ...(input.numberLabel.trim() ? { numberLabel: input.numberLabel.trim() } : {}),
            ...(input.specSection.trim() ? { specSection: input.specSection.trim() } : {}),
            ...(input.responsibleCompanyId
              ? { responsibleCompanyId: input.responsibleCompanyId }
              : {}),
            ...(input.requiredOnSite ? { requiredOnSite: input.requiredOnSite } : {}),
          },
        }),
      );
    },
    update: async (projectId, id, version, input) => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/{submittalId}`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
          body: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.numberLabel ? { numberLabel: input.numberLabel } : {}),
            ...(input.specSection !== undefined ? { specSection: input.specSection || null } : {}),
            ...(input.responsibleCompanyId
              ? { responsibleCompanyId: input.responsibleCompanyId }
              : {}),
            ...(input.requiredOnSite !== undefined
              ? { requiredOnSite: input.requiredOnSite || null }
              : {}),
            ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
            ...(input.reviewDays !== undefined ? { reviewDays: input.reviewDays } : {}),
          },
        }),
      );
    },
    submit: async (projectId, id, version, input) => {
      await ensureCsrfToken();
      const fileIds = await upload(projectId, input.files);
      return unwrap(
        await api.POST(`${P}/{submittalId}/submit`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
          body: {
            fileIds,
            ...(input.note.trim() ? { note: input.note.trim() } : {}),
            ...(input.reviewerIds ? { reviewerIds: input.reviewerIds } : {}),
          },
        }),
      );
    },
    respond: async (projectId, id, stepId, input) => {
      await ensureCsrfToken();
      const fileIds = await upload(projectId, input.files);
      return unwrap(
        await api.POST(`${P}/{submittalId}/steps/{stepId}/respond`, {
          params: { path: { ...path(projectId, id), stepId } },
          body: {
            response: input.response,
            ...(input.comments.trim() ? { comments: input.comments.trim() } : {}),
            ...(fileIds.length ? { fileIds } : {}),
          },
        }),
      );
    },
    close: async (projectId, id, version) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/{submittalId}/close`, {
          params: { path: path(projectId, id), header: ifMatch(version) },
        }),
      );
    },
  };
}
