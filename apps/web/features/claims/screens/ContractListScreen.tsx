'use client';

import Link from 'next/link';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useCanReviewContracts } from '@/features/contract-review';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { Contract } from '../data/api';
import { useContracts } from '../hooks/useClaims';
import { KIND_LABELS } from '../lib/deadline';
import { aud } from '../lib/money';

/** The project's head contract and subcontracts (CLM-US1). Subcontractors see only theirs. */
export function ContractListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'contracts', id: 'register' },
  });
  const q = useContracts(project.projectId);
  const canManage =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.payment_claims, 'admin');
  const canReview = useCanReviewContracts();
  const company = (id: string | null) => dir.companies.find((c) => c.id === id)?.name ?? '—';

  const columns: DataTableColumn<Contract>[] = [
    {
      id: 'number',
      header: 'No.',
      sortValue: (c) => c.number,
      cell: (c) => <span className="u-mono">C-{String(c.number).padStart(3, '0')}</span>,
    },
    {
      id: 'title',
      header: 'Contract',
      rowHeader: true,
      sortValue: (c) => c.title,
      cell: (c) => (
        <Link className="link" href={webRoutes.contract(org.orgSlug, project.projectId, c.id)}>
          {c.title}
        </Link>
      ),
    },
    { id: 'kind', header: 'Type', sortValue: (c) => c.kind, cell: (c) => KIND_LABELS[c.kind] },
    {
      id: 'payee',
      header: 'Payee',
      sortValue: (c) => company(c.payeeCompanyId),
      cell: (c) => company(c.payeeCompanyId),
    },
    { id: 'state', header: 'SOPA state', sortValue: (c) => c.sopaState, cell: (c) => c.sopaState },
    {
      id: 'value',
      header: 'Value (ex GST)',
      align: 'end',
      sortValue: (c) => Number(c.originalValue),
      cell: (c) => <span className="u-mono">{aud(c.originalValue)}</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Contracts"
        description="Each contract carries its schedule of values, retention and the Security of Payment state its claims run under."
        actions={
          <>
            {canReview ? (
              <Link
                className="link"
                href={webRoutes.contractReviews(org.orgSlug, project.projectId)}
              >
                <Button type="button" variant="secondary">
                  Review with Nova
                </Button>
              </Link>
            ) : null}
            {canManage ? (
              <Link className="link" href={webRoutes.newContract(org.orgSlug, project.projectId)}>
                <Button type="button">New contract</Button>
              </Link>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={q.error} title="We couldn't load the contracts" />
      {q.isPending ? (
        <SkeletonRows label="Loading contracts…" />
      ) : q.data ? (
        <DataTable
          caption="Contracts"
          columns={columns}
          rows={q.data}
          getRowId={(c) => c.id}
          defaultSort={{ columnId: 'number', direction: 'asc' }}
          empty={
            <EmptyState
              title="No contracts yet"
              description="Set up a contract with its schedule of values, then record each payment claim against it."
            />
          }
        />
      ) : null}
    </div>
  );
}
