'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createPrequalApi, type TemplateFields, type TemplatePatch } from '../data/api';
import type { Answers, Prequalification, PrequalTemplate, Qualification } from '../lib/types';

const key = (orgId: string) => ['orgs', orgId, 'prequal'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createPrequalApi(orgId), [orgId]);
}

export function useRegister(f: { state?: Qualification; trade?: string }) {
  const { orgId } = useCurrentOrg();
  const p = useApi();
  return useQuery({
    queryKey: [...key(orgId), 'register', { ...f }],
    queryFn: () => p.register(f),
  });
}

export function useForms() {
  const { orgId } = useCurrentOrg();
  const p = useApi();
  return useQuery({ queryKey: [...key(orgId), 'forms'], queryFn: () => p.list({}) });
}

export function useForm(id: string) {
  const { orgId } = useCurrentOrg();
  const p = useApi();
  return useQuery({ queryKey: [...key(orgId), 'form', id], queryFn: () => p.get(id) });
}

export function useTemplates() {
  const { orgId } = useCurrentOrg();
  const p = useApi();
  return useQuery({ queryKey: [...key(orgId), 'templates'], queryFn: () => p.templates() });
}

export function useCompanies() {
  const { orgId } = useCurrentOrg();
  const p = useApi();
  return useQuery({
    queryKey: ['directory', orgId, 'companies'],
    queryFn: () => p.companies(),
    staleTime: 5 * 60_000,
  });
}

export function usePrequalMutations() {
  const { orgId } = useCurrentOrg();
  const p = useApi();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async <T>(v: T) => {
    await qc.invalidateQueries({ queryKey: key(orgId) });
    return v;
  };
  return {
    createTemplate: useMutation({
      mutationFn: async (b: TemplateFields) => settle(await p.createTemplate(b)),
    }),
    updateTemplate: useMutation({
      mutationFn: async (v: { t: PrequalTemplate; body: TemplatePatch }) =>
        settle(await p.updateTemplate(v.t, v.body)),
    }),
    publishTemplate: useMutation({
      mutationFn: async (t: PrequalTemplate) => settle(await p.publishTemplate(t)),
    }),
    newVersion: useMutation({
      mutationFn: async (t: PrequalTemplate) => settle(await p.newTemplateVersion(t)),
    }),
    create: useMutation({
      mutationFn: async (v: { companyId: string; templateId: string; trades: string[] }) =>
        settle(await p.create(v)),
    }),
    save: useMutation({
      mutationFn: async (v: { form: Prequalification; answers: Answers; trades: string[] }) =>
        settle(await p.save(v.form, { answers: v.answers, trades: v.trades })),
    }),
    submit: useMutation({
      mutationFn: async (v: { form: Prequalification; answers: Answers; trades: string[] }) => {
        // Save what is on screen first so the submit sees it, then submit the saved version.
        const saved = await p.save(v.form, { answers: v.answers, trades: v.trades });
        return settle(await p.submit(saved));
      },
    }),
    approve: useMutation({
      mutationFn: async (v: { form: Prequalification; note: string; expiresOn: string }) =>
        settle(
          await p.approve(v.form, {
            ...(v.note.trim() ? { note: v.note.trim() } : {}),
            ...(v.expiresOn ? { expiresOn: v.expiresOn } : {}),
          }),
        ),
    }),
    reject: useMutation({
      mutationFn: async (v: { form: Prequalification; note: string }) =>
        settle(await p.reject(v.form, v.note.trim())),
    }),
  };
}
