'use client';

import { useState } from 'react';
import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import {
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  ToggleGroup,
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
import {
  byCompany,
  expiryHint,
  filterEntries,
  summarise,
  type BoardFilter,
  type CompanyRow,
} from '../lib/board';
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
  const [filter, setFilter] = useState<BoardFilter>('all');
  const all = register.data?.data ?? [];
  const summary = summarise(all);

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
      cell: (e) =>
        e.expiringSoon ? (
          <StatusPill tone="warning">Expiring soon</StatusPill>
        ) : (
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
      cell: (e) => {
        if (!e.completion?.expiresOn) return '—';
        const hint = expiryHint(e.daysToExpiry);
        return hint
          ? `${formatLocalDate(e.completion.expiresOn)} (${hint})`
          : formatLocalDate(e.completion.expiresOn);
      },
    },
    {
      id: 'credentials',
      header: 'On file',
      cell: (e) =>
        e.credentials.length ? e.credentials.map((c) => credentialLabel(c.kind)).join(', ') : '—',
    },
  ];

  const companyColumns: DataTableColumn<CompanyRow>[] = [
    {
      id: 'company',
      header: 'Company',
      rowHeader: true,
      sortValue: (c) => c.company,
      cell: (c) => c.company,
    },
    {
      id: 'total',
      header: 'Workers',
      align: 'end',
      sortValue: (c) => c.total,
      cell: (c) => c.total,
    },
    {
      id: 'current',
      header: 'Current',
      align: 'end',
      sortValue: (c) => c.current,
      cell: (c) => c.current,
    },
    {
      id: 'expiring',
      header: 'Expiring soon',
      align: 'end',
      sortValue: (c) => c.expiringSoon,
      cell: (c) => c.expiringSoon,
    },
    {
      id: 'lapsed',
      header: 'Expired or out of date',
      align: 'end',
      sortValue: (c) => c.expiredOrOutdated,
      cell: (c) => c.expiredOrOutdated,
    },
    {
      id: 'none',
      header: 'Not inducted',
      align: 'end',
      sortValue: (c) => c.notInducted,
      cell: (c) => c.notInducted,
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
        description="Everyone who has started or finished the site induction, who is about to lapse, and which subcontractors to chase."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inductions" /> : null}
      <ErrorAlert error={register.error} title="We couldn't load the register" />
      {register.isPending ? (
        <SkeletonRows label="Loading register…" />
      ) : (
        <>
          <StatGrid
            items={[
              { label: 'Workers', value: summary.total },
              { label: 'Current', value: summary.current, tone: 'success' },
              {
                label: 'Expiring in 30 days',
                value: summary.expiringSoon,
                tone: summary.expiringSoon > 0 ? 'warning' : 'neutral',
              },
              {
                label: 'Expired or out of date',
                value: summary.expiredOrOutdated,
                tone: summary.expiredOrOutdated > 0 ? 'danger' : 'neutral',
              },
              { label: 'Not inducted', value: summary.notInducted },
            ]}
          />
          {all.length > 0 ? (
            <DataTable
              caption="Induction status by company"
              columns={companyColumns}
              rows={byCompany(all, companyOf)}
              getRowId={(c) => c.key}
            />
          ) : null}
          <ToggleGroup
            label="Show"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'action', label: 'Needs action' },
              { value: 'expiring', label: 'Expiring soon' },
              { value: 'current', label: 'Current' },
            ]}
          />
          <DataTable
            caption="Induction register"
            columns={columns}
            rows={filterEntries(all, filter)}
            getRowId={(e) => e.worker.id}
            defaultSort={{ columnId: 'worker', direction: 'asc' }}
            empty={
              <EmptyState
                icon={InductionsIcon}
                title={all.length ? 'Nobody matches this filter' : 'Nobody has been inducted yet'}
                description={
                  all.length
                    ? 'Try another view.'
                    : 'Workers appear here once they start the published induction.'
                }
              />
            }
          />
        </>
      )}
    </div>
  );
}
