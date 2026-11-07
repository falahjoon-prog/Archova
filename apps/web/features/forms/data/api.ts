// Forms against the forms module's endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type FormTemplate = S['FormTemplate'];
export type FormField = S['FormField'];
export type FormSummary = S['FormSummary'];
export type FormDetail = S['FormDetail'];
export type FormAttention = S['FormAttention'];
export type TemplateInput = Omit<S['CreateFormTemplateRequest'], 'copyFromLibraryKey'>;

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const P = '/v1/orgs/{orgId}/projects/{projectId}';

export function createFormsApi(orgId: string) {
  return {
    projectTemplates: async (projectId: string): Promise<FormTemplate[]> =>
      unwrap(await api.GET(`${P}/form-templates`, { params: { path: { orgId, projectId } } })).data,
    orgTemplates: async (): Promise<FormTemplate[]> =>
      unwrap(await api.GET('/v1/orgs/{orgId}/form-templates', { params: { path: { orgId } } }))
        .data,
    createTemplate: async (
      body: TemplateInput & { copyFromLibraryKey?: string },
    ): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/form-templates', {
          params: { path: { orgId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    updateTemplate: async (
      templateId: string,
      version: number,
      body: S['UpdateFormTemplateRequest'],
    ): Promise<FormTemplate> => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/form-templates/{templateId}', {
          params: { path: { orgId, templateId }, header: ifMatch(version) },
          body,
        }),
      );
    },
    list: async (projectId: string, limit = 200): Promise<FormSummary[]> =>
      unwrap(
        await api.GET(`${P}/forms`, {
          params: { path: { orgId, projectId }, query: { limit } },
        }),
      ).data,
    attention: async (projectId: string): Promise<FormAttention[]> =>
      unwrap(await api.GET(`${P}/forms/attention`, { params: { path: { orgId, projectId } } }))
        .data,
    get: async (projectId: string, formId: string): Promise<FormDetail> =>
      unwrap(
        await api.GET(`${P}/forms/{formId}`, { params: { path: { orgId, projectId, formId } } }),
      ),
    start: async (projectId: string, templateId: string): Promise<FormDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/forms`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: { templateId },
        }),
      );
    },
    save: async (
      projectId: string,
      formId: string,
      version: number,
      body: S['SaveFormRequest'],
    ): Promise<FormDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/forms/{formId}`, {
          params: { path: { orgId, projectId, formId }, header: ifMatch(version) },
          body,
        }),
      );
    },
    sign: async (
      projectId: string,
      formId: string,
      body: S['SignFormRequest'],
    ): Promise<FormDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/forms/{formId}/signatures`, {
          params: { path: { orgId, projectId, formId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    submit: async (projectId: string, formId: string, version: number): Promise<FormDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/forms/{formId}/submit`, {
          params: { path: { orgId, projectId, formId }, header: ifMatch(version) },
        }),
      );
    },
  };
}
