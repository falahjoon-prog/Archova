'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createLinksApi, type LinkEntityType, type LinkReason } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createLinksApi(orgId), [orgId]);
}

/** Everything linked to one record. */
export function useRelatedItems(projectId: string, type: LinkEntityType, id: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'related-items', { type, id }),
    queryFn: () => source.list(projectId, type, id),
  });
}

/** Records of one type that can be linked, as the person types. */
export function useLinkCandidates(
  projectId: string,
  type: LinkEntityType,
  q: string,
  enabled: boolean,
) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'related-items', { candidates: type, q }),
    queryFn: () => source.candidates(projectId, type, q),
    enabled,
  });
}

/** A link shows on both records, so any change refreshes every related-items list on the project. */
function useRefresh(projectId: string) {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'related-items') });
}

export function useAddLink(projectId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: {
      from: { type: LinkEntityType; id: string };
      to: { type: LinkEntityType; id: string };
      reason: LinkReason;
      note?: string | null;
    }) => source.create(projectId, v),
    onSuccess: refresh,
  });
}

export function useRemoveLink(projectId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (linkId: string) => source.remove(projectId, linkId),
    onSuccess: refresh,
  });
}
