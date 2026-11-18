'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createHandoverApi } from '../data/api';
import { handoverPreview, type HandoverSource } from '../data/source';
import type { HandoverAction, HandoverInput, HandoverItem } from '../lib/types';

function useSource(): HandoverSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? handoverPreview : createHandoverApi(orgId)), [orgId]);
}

export function useHandoverPack() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'handover', { pack: true }),
    queryFn: () => source.pack(projectId),
  });
}

export function useHandoverExport() {
  const source = useSource();
  const { projectId } = useCurrentProject();
  return useMutation({ mutationFn: () => source.export(projectId) });
}

export function useHandoverMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'handover') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: HandoverInput) => settle(await source.create(projectId, input)),
    }),
    update: useMutation({
      mutationFn: async (v: { item: HandoverItem; input: Partial<HandoverInput> }) =>
        settle(await source.update(projectId, v.item, v.input)),
    }),
    transition: useMutation({
      mutationFn: async (v: {
        item: HandoverItem;
        input: { action: HandoverAction; note?: string };
      }) => settle(await source.transition(projectId, v.item, v.input)),
    }),
    /** Uploads the files onto the item, then marks it received in one go. */
    receive: useMutation({
      mutationFn: async (v: { item: HandoverItem; files: File[] }) => {
        const withFiles = v.files.length ? await source.attach(projectId, v.item, v.files) : v.item;
        return settle(await source.transition(projectId, withFiles, { action: 'receive' }));
      },
    }),
    attach: useMutation({
      mutationFn: async (v: { item: HandoverItem; files: File[] }) =>
        settle(await source.attach(projectId, v.item, v.files)),
    }),
    applyTemplate: useMutation({
      mutationFn: async () => settle(await source.applyTemplate(projectId)),
    }),
    issue: useMutation({
      mutationFn: async (v: {
        recipientName: string;
        note?: string;
        acknowledgeIncomplete?: boolean;
      }) => settle(await source.issue(projectId, v)),
    }),
  };
}
