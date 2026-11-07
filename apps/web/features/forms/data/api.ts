// Custom forms against the forms module's endpoints.
import { unwrap } from '@archova/api-client';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  Answers,
  FormSubmission,
  FormSubmissionDetail,
  FormSuggestion,
  FormTemplate,
  FormTemplateInput,
  SubmissionStatus,
} from '../lib/types';

const T = '/v1/orgs/{orgId}/projects/{projectId}/form-templates' as const;
const S = '/v1/orgs/{orgId}/projects/{projectId}/form-submissions' as const;
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export interface SubmissionFilters {
  status?: SubmissionStatus;
  templateId?: string;
  mine?: boolean;
  flagged?: boolean;
}

export function createFormsApi(orgId: string) {
  return {
    templates: async (projectId: string): Promise<FormTemplate[]> =>
      unwrap(await api.GET(T, { params: { path: { orgId, projectId }, query: {} } })).data,
    createTemplate: async (projectId: string, body: FormTemplateInput): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(T, { params: { path: { orgId, projectId }, header: key() }, body }),
      );
    },
    updateTemplate: async (
      projectId: string,
      templateId: string,
      body: FormTemplateInput,
    ): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.PUT(`${T}/{templateId}`, {
          params: { path: { orgId, projectId, templateId } },
          body,
        }),
      );
    },
    publishTemplate: async (projectId: string, templateId: string): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${T}/{templateId}/publish`, {
          params: { path: { orgId, projectId, templateId }, header: key() },
        }),
      );
    },
    archiveTemplate: async (projectId: string, templateId: string): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${T}/{templateId}/archive`, {
          params: { path: { orgId, projectId, templateId }, header: key() },
        }),
      );
    },
    newTemplateVersion: async (projectId: string, templateId: string): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${T}/{templateId}/versions`, {
          params: { path: { orgId, projectId, templateId }, header: key() },
        }),
      );
    },
    submissions: async (
      projectId: string,
      f: SubmissionFilters,
      cursor?: string,
    ): Promise<{ data: FormSubmission[]; nextCursor: string | null }> =>
      unwrap(
        await api.GET(S, {
          params: {
            path: { orgId, projectId },
            query: {
              limit: 50,
              ...(f.status ? { status: f.status } : {}),
              ...(f.templateId ? { templateId: f.templateId } : {}),
              ...(f.mine ? { mine: 'true' as const } : {}),
              ...(f.flagged ? { flagged: 'true' as const } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
    submission: async (projectId: string, submissionId: string): Promise<FormSubmissionDetail> =>
      unwrap(
        await api.GET(`${S}/{submissionId}`, {
          params: { path: { orgId, projectId, submissionId } },
        }),
      ),
    assign: async (
      projectId: string,
      body: { templateId: string; title?: string; assigneeId?: string; dueDate?: string },
    ): Promise<FormSubmissionDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(S, { params: { path: { orgId, projectId }, header: key() }, body }),
      );
    },
    save: async (
      projectId: string,
      submissionId: string,
      body: { answers?: Record<string, Answers[string] | null>; fileIds?: string[] },
    ): Promise<FormSubmissionDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.PUT(`${S}/{submissionId}/answers`, {
          params: { path: { orgId, projectId, submissionId } },
          body,
        }),
      );
    },
    submit: async (projectId: string, submissionId: string): Promise<FormSubmissionDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${S}/{submissionId}/submit`, {
          params: { path: { orgId, projectId, submissionId }, header: key() },
        }),
      );
    },
    review: async (
      projectId: string,
      submissionId: string,
      decision: 'close' | 'return',
    ): Promise<FormSubmissionDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${S}/{submissionId}/review`, {
          params: { path: { orgId, projectId, submissionId }, header: key() },
          body: { decision },
        }),
      );
    },
    suggestions: async (projectId: string, submissionId: string): Promise<FormSuggestion[]> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${S}/{submissionId}/suggestions`, {
          params: { path: { orgId, projectId, submissionId } },
        }),
      ).data;
    },
    upload: async (projectId: string, file: File): Promise<string> =>
      (await uploadFile(orgId, { file, projectId, module: 'forms' })).id,
  };
}

export type FormsApi = ReturnType<typeof createFormsApi>;
