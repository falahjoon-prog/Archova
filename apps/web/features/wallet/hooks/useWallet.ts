'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createWalletApi, type CreateDocument, type UpdateDocument } from '../data/api';
import type { ComplianceDocument, ItemType } from '../lib/types';

const key = (orgId: string) => ['orgs', orgId, 'compliance-documents'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createWalletApi(orgId), [orgId]);
}

export function useDocuments(f: { itemType?: ItemType; includeArchived: boolean }) {
  const { orgId } = useCurrentOrg();
  const wallet = useApi();
  return useQuery({ queryKey: [...key(orgId), { ...f }], queryFn: () => wallet.list(f) });
}

export function useWalletMutations() {
  const { orgId } = useCurrentOrg();
  const wallet = useApi();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async <T>(v: T) => {
    await qc.invalidateQueries({ queryKey: key(orgId) });
    return v;
  };
  return {
    create: useMutation({
      mutationFn: async (v: { body: CreateDocument; files: File[] }) => {
        const fileIds = await Promise.all(v.files.map((f) => wallet.upload(f)));
        return settle(await wallet.create({ ...v.body, ...(fileIds.length ? { fileIds } : {}) }));
      },
    }),
    update: useMutation({
      mutationFn: async (v: { doc: ComplianceDocument; body: UpdateDocument; files: File[] }) => {
        const added = await Promise.all(v.files.map((f) => wallet.upload(f)));
        const body = added.length ? { ...v.body, fileIds: [...v.doc.fileIds, ...added] } : v.body;
        return settle(await wallet.update(v.doc, body));
      },
    }),
    archive: useMutation({
      mutationFn: async (v: { doc: ComplianceDocument; archived: boolean }) =>
        settle(await wallet.update(v.doc, { archived: v.archived })),
    }),
    sight: useMutation({
      mutationFn: async (doc: ComplianceDocument) => settle(await wallet.sight(doc)),
    }),
  };
}
