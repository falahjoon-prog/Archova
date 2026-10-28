'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, PageHeader } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { DefectForm } from '../forms/DefectForm';
import { useDefectMutations, useDefectsSource } from '../hooks/useDefects';
import { formatDefectNumber } from '../lib/types';

export function DefectNewScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'defects', id: 'new' },
  });
  const { create } = useDefectMutations();
  const { live } = useDefectsSource();
  const [saved, setSaved] = useState<string[]>([]);

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.defects(org.orgSlug, project.projectId)}>
            Defects
          </Link>
        }
        title="New defect"
        description={
          live
            ? 'Choose the drawing, mark where it is and who fixes it. Photos go to the company with the defect.'
            : 'Choose where it is and who fixes it. Add a pin on the drawing from the drawing viewer or the phone.'
        }
      />
      {live ? null : <PreviewDataNotice tool="Defects" />}
      {saved.length ? (
        <Alert tone="success" title={`Saved ${saved.join(', ')}`}>
          Keep going, or{' '}
          <Link className="link" href={webRoutes.defects(org.orgSlug, project.projectId)}>
            go to the register
          </Link>
          .
        </Alert>
      ) : null}
      <DefectForm
        busy={create.isPending}
        error={create.error}
        onSave={(input, meta) =>
          create.mutateAsync({ input, aiSuggestionId: meta.aiSuggestionId }).then((d) => {
            if (meta.another) setSaved((s) => [...s, formatDefectNumber(d.number)]);
            else router.push(webRoutes.defect(org.orgSlug, project.projectId, d.id));
          })
        }
      />
    </div>
  );
}
