'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { RfiForm, emptyRfiInput } from '../forms/RfiForm';
import { useRfiMutations } from '../hooks/useRfis';
import type { RfiInput } from '../lib/types';

export function RfiNewScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'rfis', id: 'new' } });
  const { create } = useRfiMutations(project.projectId);
  const save = (input: RfiInput, submit: boolean) =>
    create.mutate(
      { input, submit },
      { onSuccess: (rfi) => router.push(webRoutes.rfi(org.orgSlug, project.projectId, rfi.id)) },
    );

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.rfis(org.orgSlug, project.projectId)}>
            RFIs
          </Link>
        }
        title="New RFI"
        description="The number is issued when you submit. Drafts stay with you until then."
      />
      {previewDataOnly ? <PreviewDataNotice tool="RFIs" /> : null}
      <RfiForm
        initial={emptyRfiInput(todayIn(project.timezone))}
        busy={create.isPending}
        error={create.error}
        onSaveDraft={(input) => save(input, false)}
        onSubmit={(input) => save(input, true)}
      />
    </div>
  );
}
