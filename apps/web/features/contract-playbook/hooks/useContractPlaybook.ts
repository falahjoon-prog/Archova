'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createContractPlaybookApi, type ContractType, type PlaybookTopic } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createContractPlaybookApi(orgId), [orgId]);
}

const key = (orgId: string, contractType: ContractType) =>
  ['contract-playbook', orgId, contractType] as const;

export function useContractPlaybook(contractType: ContractType, enabled = true) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({
    queryKey: key(orgId, contractType),
    queryFn: () => api.get(contractType),
    enabled,
  });
}

export function useSaveContractPlaybook(contractType: ContractType) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topics: PlaybookTopic[]) => api.replace(contractType, topics),
    onSuccess: (saved) => qc.setQueryData(key(orgId, contractType), saved),
  });
}
