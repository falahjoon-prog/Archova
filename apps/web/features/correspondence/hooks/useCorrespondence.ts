'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  correspondencePreview,
  createCorrespondenceApi,
  type CorrespondenceSource,
} from '../data/api';
import type {
  CorrespondenceDetail,
  CorrespondenceFilters,
  CorrespondenceInput,
  CorrespondenceType,
} from '../lib/types';

function useSource(): CorrespondenceSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? correspondencePreview : createCorrespondenceApi(orgId)),
    [orgId],
  );
}

export function useCorrespondenceList(projectId: string, filters: CorrespondenceFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'correspondence', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useCorrespondence(projectId: string, id: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'correspondence', id),
    queryFn: () => source.get(projectId, id),
  });
}

/** The active types a user can write on this project. */
export function useProjectTypes(projectId: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: [...queryKeys.tool(orgId, projectId, 'correspondence'), 'types'],
    queryFn: () => source.projectTypes(projectId),
  });
}

/** Org-level setup for admins: every type (archived too) and the built-in AU templates to copy from. */
export function useTypeSetup(enabled: boolean) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ['orgs', orgId, 'correspondence-types'],
    queryFn: () => source.orgTypes(),
    enabled,
  });
  const templates = useQuery({
    queryKey: ['orgs', orgId, 'correspondence-templates'],
    queryFn: () => source.templates(),
    enabled,
  });
  // The project pickers cache under each project's tool key, so refresh the whole org's queries.
  const refresh = () => qc.invalidateQueries({ queryKey: ['orgs', orgId] });
  return {
    types,
    templates,
    add: useMutation({ mutationFn: (key: string) => source.addType(key), onSuccess: refresh }),
    archive: useMutation({
      mutationFn: (t: CorrespondenceType) => source.archiveType(t),
      onSuccess: refresh,
    }),
  };
}

/** Every write waits for the server: a notice is part of the record, so none of them is optimistic. */
export function useCorrespondenceMutations(projectId: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  const settle = (d: CorrespondenceDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'correspondence', d.item.id), d);
    return qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'correspondence') });
  };
  return {
    create: useMutation({
      mutationFn: (input: CorrespondenceInput) => source.create(projectId, input),
      onSuccess: settle,
    }),
    update: useMutation({
      mutationFn: (v: {
        id: string;
        version: number;
        subject?: string;
        body?: string;
        toCompanyIds?: string[];
        eventDate?: string;
      }) => source.update(projectId, v.id, v.version, v),
      onSuccess: settle,
    }),
    send: useMutation({
      mutationFn: (v: { id: string; version: number }) => source.send(projectId, v.id, v.version),
      onSuccess: settle,
    }),
    respond: useMutation({
      mutationFn: (v: { id: string; body: string; files: File[] }) =>
        source.respond(projectId, v.id, v),
      onSuccess: settle,
    }),
    close: useMutation({
      mutationFn: (v: { id: string; version: number }) => source.close(projectId, v.id, v.version),
      onSuccess: settle,
    }),
    voidItem: useMutation({
      mutationFn: (v: { id: string; version: number; reason: string }) =>
        source.voidItem(projectId, v.id, v.version, v.reason),
      onSuccess: settle,
    }),
  };
}
