'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { EstimatingIcon, Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { EstimateSummary } from '../data/estimates-api';
import { useEstimateMutations, useEstimates } from '../hooks/useEstimates';
import { dollars } from '../lib/estimate-format';

/** Estimate sheets on the project (EST-US11). */
export function EstimateListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'estimates', id: 'list' },
  });
  const estimates = useEstimates();
  const { create } = useEstimateMutations();
  const [name, setName] = useState<string | null>(null);

  const columns: DataTableColumn<EstimateSummary>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (e) => e.number,
      cell: (e) => (
        <Link
          className="link u-mono"
          href={webRoutes.estimate(org.orgSlug, project.projectId, e.id)}
        >
          {e.numberLabel}
        </Link>
      ),
    },
    { id: 'name', header: 'Estimate', sortValue: (e) => e.name, cell: (e) => e.name },
    {
      id: 'status',
      header: 'Status',
      sortValue: (e) => e.status,
      cell: (e) => (
        <StatusPill tone={e.status === 'issued' ? 'success' : 'neutral'}>
          {e.status === 'issued' ? 'Issued' : 'Draft'}
        </StatusPill>
      ),
    },
    { id: 'base', header: 'Rates as at', sortValue: (e) => e.baseDate, cell: (e) => e.baseDate },
    {
      id: 'total',
      header: 'Total ex GST',
      align: 'end',
      cell: (e) =>
        e.totalExGst ? dollars(e.totalExGst) : <span className="u-muted">Not issued</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Estimating"
        title="Estimates"
        description="Price accepted takeoff quantities from your cost library, add contingency, margin and GST, and issue the tender price."
        actions={
          <Button onClick={() => setName('')}>
            <Plus size={16} aria-hidden="true" /> New estimate
          </Button>
        }
      />
      {previewDataOnly ? (
        <PreviewDataNotice tool="Estimates" />
      ) : (
        <>
          <ErrorAlert error={estimates.error} title="We couldn't load estimates" />
          {estimates.isPending ? (
            <SkeletonRows label="Loading estimates…" />
          ) : (
            <DataTable
              caption="Estimates"
              columns={columns}
              rows={estimates.data ?? []}
              getRowId={(e) => e.id}
              defaultSort={{ columnId: 'number', direction: 'desc' }}
              empty={
                <EmptyState
                  icon={EstimatingIcon}
                  title="No estimates yet"
                  description="Start a sheet, or send accepted quantities to one from the drawing viewer."
                />
              }
            />
          )}
        </>
      )}
      <Dialog
        open={name !== null}
        onClose={() => setName(null)}
        title="New estimate"
        footer={
          <>
            <Button variant="secondary" onClick={() => setName(null)}>
              Cancel
            </Button>
            <Button
              disabled={!name?.trim() || create.isPending}
              onClick={() =>
                create.mutate(
                  { name: name ?? '' },
                  {
                    onSuccess: (e) =>
                      router.push(webRoutes.estimate(org.orgSlug, project.projectId, e.id)),
                  },
                )
              }
            >
              Create estimate
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Name" value={name ?? ''} onChange={(e) => setName(e.target.value)} />
          <ErrorAlert error={create.error} title="We couldn't create the estimate" />
        </div>
      </Dialog>
    </div>
  );
}
