'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import {
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { InductionsIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useInductionRegister } from '../hooks/useBuilder';
import { REGISTER_STATUS, type InductionRegisterEntry } from '../lib/types';

const CREDENTIAL_KINDS: Record<string, string> = { white_card: 'White card' };
const credentialLabel = (kind: string) =>
  CREDENTIAL_KINDS[kind] ?? kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Who has completed the induction, on which version, and what is on file for them (IND-AC9). */
export function InductionRegisterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const directory = useProjectDirectory();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'induction-register', id: 'list' },
  });
  const register = useInductionRegister();

  const columns: DataTableColumn<InductionRegisterEntry>[] = [
    {
      id: 'worker',
      header: 'Worker',
      rowHeader: true,
      sortValue: (e) => e.worker.fullName,
      cell: (e) => e.worker.fullName,
    },
    {
      id: 'company',
      header: 'Company',
      sortValue: (e) => companyOf(e),
      cell: (e) => companyOf(e),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (e) => e.status,
      cell: (e) => (
        <StatusPill tone={REGISTER_STATUS[e.status].tone}>
          {REGISTER_STATUS[e.status].label}
        </StatusPill>
      ),
    },
    {
      id: 'version',
      header: 'Version',
      align: 'end',
      sortValue: (e) => e.completion?.versionNumber ?? 0,
      cell: (e) => (e.completion ? `v${e.completion.versionNumber}` : '—'),
    },
    {
      id: 'score',
      header: 'Score',
      align: 'end',
      sortValue: (e) => e.completion?.score ?? -1,
      cell: (e) => (e.completion && e.completion.score !== null ? `${e.completion.score}%` : '—'),
    },
    {
      id: 'expires',
      header: 'Expires',
      sortValue: (e) => e.completion?.expiresOn ?? '',
      cell: (e) => (e.completion?.expiresOn ? formatLocalDate(e.completion.expiresOn) : '—'),
    },
    {
      id: 'credentials',
      header: 'On file',
      cell: (e) =>
        e.credentials.length ? e.credentials.map((c) => credentialLabel(c.kind)).join(', ') : '—',
    },
  ];

  function companyOf(e: InductionRegisterEntry): string {
    return e.worker.companyId
      ? directory.companyName(e.worker.companyId)
      : (e.worker.companyNameOther ?? '—');
  }

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.inductions(org.orgSlug, project.projectId)}>
            All inductions
          </Link>
        }
        title="Induction register"
        description="Everyone who has started or finished the site induction, on the version they completed."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inductions" /> : null}
      <ErrorAlert error={register.error} title="We couldn't load the register" />
      {register.isPending ? (
        <SkeletonRows label="Loading register…" />
      ) : (
        <DataTable
          caption="Induction register"
          columns={columns}
          rows={register.data?.data ?? []}
          getRowId={(e) => e.worker.id}
          defaultSort={{ columnId: 'worker', direction: 'asc' }}
          empty={
            <EmptyState
              icon={InductionsIcon}
              title="Nobody has been inducted yet"
              description="Workers appear here once they start the published induction."
            />
          }
        />
      )}
    </div>
  );
}
