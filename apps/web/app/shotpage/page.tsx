'use client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AssistantScopeProvider } from '@/features/assistant';
import { CurrentOrgProvider } from '@/shared/providers/CurrentOrgProvider';
import { CurrentProjectProvider } from '@/shared/providers/CurrentProjectProvider';
import { InductionEditorScreen } from '@/features/inductions/builder/screens/InductionEditorScreen';
import { inductionBuilderSource, resetInductionBuilderPreview } from '@/features/inductions/builder/data/source';

function Inner() {
  const q = useQuery({ queryKey: ['x'], queryFn: async () => { resetInductionBuilderPreview('prj_test'); return inductionBuilderSource.create('prj_test', { title: 'Harbour St induction', validityMonths: 12 }); } });
  return q.data ? <InductionEditorScreen inductionId={q.data.id} /> : null;
}
export default function Page() {
  const [c] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={c}>
      <CurrentOrgProvider org={{ orgId: 'org_test', orgSlug: 'acme', orgName: 'Acme', role: 'admin', kind: 'member', user: { id: 'u', name: 'T' } } as never}>
        <CurrentProjectProvider project={{ projectId: 'prj_test', name: 'Harbour St Tower', number: 'HST-01', timezone: 'Australia/Sydney', state: 'NSW', companyId: 'cmp_builder' } as never}>
          <AssistantScopeProvider><main style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}><Inner /></main></AssistantScopeProvider>
        </CurrentProjectProvider>
      </CurrentOrgProvider>
    </QueryClientProvider>
  );
}
