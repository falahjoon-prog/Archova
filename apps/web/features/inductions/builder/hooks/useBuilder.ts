'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createInductionBuilderApi } from '../data/api';
import { inductionBuilderSource, type InductionBuilderSource } from '../data/source';
import type {
  CreateInductionLinkInput,
  Induction,
  InductionContent,
  PublishInput,
} from '../lib/types';

/** The API once the workforce endpoints are reachable; the in-browser preview store in preview mode and tests. */
export function useBuilderSource(): InductionBuilderSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? inductionBuilderSource : createInductionBuilderApi(orgId)),
    [orgId],
  );
}

export function useInductions() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'inductions'),
    queryFn: () => source.list(projectId),
  });
}

export function useInduction(inductionId: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'inductions', inductionId),
    queryFn: () => source.get(projectId, inductionId),
  });
}

export function useInductionRegister() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'inductions', { register: true }),
    queryFn: () => source.register(projectId),
  });
}

export function useCreateInduction() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; validityMonths: number }) =>
      source.create(projectId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'inductions') }),
  });
}

/**
 * Every write waits for the server: approving and publishing are decisions on a safety document, and each answer
 * carries the induction's new version for the next write's If-Match.
 */
export function useInductionMutations(induction: Induction) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  const qc = useQueryClient();
  const settle = (next: Induction) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'inductions', next.id), next);
    return qc.invalidateQueries({ queryKey: queryKeys.toolList(orgId, projectId, 'inductions') });
  };
  return {
    update: useMutation({
      mutationFn: (patch: { title?: string; validityMonths?: number; status?: 'archived' }) =>
        source.update(projectId, induction, patch),
      onSuccess: settle,
    }),
    saveDraft: useMutation({
      mutationFn: (content: InductionContent) => source.saveDraft(projectId, induction, content),
      onSuccess: settle,
    }),
    approve: useMutation({
      mutationFn: (section: number) => source.approve(projectId, induction, section),
      onSuccess: settle,
    }),
    publish: useMutation({
      mutationFn: (input: PublishInput) => source.publish(projectId, induction, input),
      onSuccess: settle,
    }),
  };
}

export function useInductionLinks(inductionId: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'inductions', { links: inductionId }),
    queryFn: () => source.listLinks(projectId, inductionId),
  });
}

/** A link's token and URL come back once, with the create; the list only ever has the link's own record. */
export function useInductionLinkMutations(inductionId: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useBuilderSource();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.toolList(orgId, projectId, 'inductions', { links: inductionId }),
    });
  return {
    create: useMutation({
      mutationFn: (input: CreateInductionLinkInput) =>
        source.createLink(projectId, inductionId, input),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (linkId: string) => source.revokeLink(projectId, inductionId, linkId),
      onSuccess: refresh,
    }),
  };
}
