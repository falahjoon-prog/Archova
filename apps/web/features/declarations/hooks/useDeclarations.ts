'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createDeclarationsApi } from '../data/api';
import { declarationsPreview, type DeclarationSource } from '../data/source';
import type { Declaration, DeclarationFilters, DeclarationInput, Requirement } from '../lib/types';

function useSource(): DeclarationSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? declarationsPreview : createDeclarationsApi(orgId)),
    [orgId],
  );
}

function useScoped<T>(
  extra: Record<string, unknown>,
  load: (s: DeclarationSource, p: string) => Promise<T>,
) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'declarations', extra),
    queryFn: () => load(source, projectId),
  });
}

export const useDeclarationList = (filters: DeclarationFilters) =>
  useScoped({ ...filters }, (s, p) => s.list(p, filters));
export const useDeclarationFlags = () => useScoped({ flags: true }, (s, p) => s.flags(p));
export const useDeclarationClaims = () => useScoped({ claims: true }, (s, p) => s.claims(p));
export const useDeclarationRequirements = () =>
  useScoped({ requirements: true }, (s, p) => s.requirements(p));

export function useDeclarationMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'declarations') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: DeclarationInput) => settle(await source.create(projectId, input)),
    }),
    update: useMutation({
      mutationFn: async (v: { declaration: Declaration; input: Partial<DeclarationInput> }) =>
        settle(await source.update(projectId, v.declaration, v.input)),
    }),
    transition: useMutation({
      mutationFn: async (v: {
        declaration: Declaration;
        input: { action: 'reject' | 'accept'; note?: string };
      }) => settle(await source.transition(projectId, v.declaration, v.input)),
    }),
    setRequirements: useMutation({
      mutationFn: async (items: Requirement[]) =>
        settle(await source.setRequirements(projectId, items)),
    }),
    chase: useMutation({
      mutationFn: (v: {
        companyId: string;
        claimId?: string;
        send: boolean;
        subject?: string;
        body?: string;
      }) => source.chase(projectId, v),
    }),
    read: useMutation({ mutationFn: (file: File) => source.read(projectId, file) }),
  };
}
