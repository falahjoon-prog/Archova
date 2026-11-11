'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createFormsApi, type FormDetail, type TemplateInput } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createFormsApi(orgId), [orgId]);
}

export function useProjectTemplates(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', { templates: true }),
    queryFn: () => source.projectTemplates(projectId),
  });
}

export function useForms(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', {}),
    queryFn: () => source.list(projectId),
  });
}

export function useFormAttention(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', { attention: true }),
    queryFn: () => source.attention(projectId),
    // Nova's flags are a nicety; a failure just hides the banner.
    retry: false,
  });
}

export function useForm(projectId: string, formId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'forms', formId),
    queryFn: () => source.get(projectId, formId),
    enabled: formId !== '',
  });
}

function useRefresh(projectId: string) {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return (detail?: FormDetail) => {
    if (detail)
      qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'forms', detail.form.id), detail);
    return qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'forms') });
  };
}

export function useStartForm(projectId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (templateId: string) => source.start(projectId, templateId),
    onSuccess: (d) => refresh(d),
  });
}

export function useSaveForm(projectId: string, formId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: { version: number; title?: string; answers?: Record<string, unknown> }) =>
      source.save(projectId, formId, v.version, {
        ...(v.title !== undefined ? { title: v.title } : {}),
        ...(v.answers ? { answers: v.answers } : {}),
      }),
    onSuccess: (d) => refresh(d),
  });
}

export function useSignForm(projectId: string, formId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: { fieldKey: string; signerName: string }) => source.sign(projectId, formId, v),
    onSuccess: (d) => refresh(d),
  });
}

export function useSubmitForm(projectId: string, formId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (version: number) => source.submit(projectId, formId, version),
    onSuccess: (d) => refresh(d),
  });
}

// ---- templates (organisation admins) -------------------------------------------------------------------------

const orgKey = (orgId: string) => ['org', orgId, 'form-templates'] as const;

export function useOrgTemplates() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: orgKey(orgId), queryFn: () => source.orgTemplates() });
}

export function useCreateTemplate() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TemplateInput & { copyFromLibraryKey?: string }) => source.createTemplate(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(orgId) }),
  });
}

export function useUpdateTemplate() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      version: number;
      patch: Parameters<typeof source.updateTemplate>[2];
    }) => source.updateTemplate(v.id, v.version, v.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(orgId) }),
  });
}
