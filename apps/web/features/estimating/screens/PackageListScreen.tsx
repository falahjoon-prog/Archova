'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { zonedToUtc } from '@archova/time';
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
import { dueInBusinessDays, formatInstant, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useCreatePackage, usePackages } from '../hooks/useQuotes';
import { PACKAGE_STATUS_LABELS, formatPackageNumber, type TenderPackage } from '../lib/quote-types';

/** Tender packages for the project (F1.3b step 1). */
export function PackageListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'tender-packages', id: 'list' },
  });
  const packages = usePackages();
  const create = useCreatePackage();
  const [open, setOpen] = useState(false);
  const today = todayIn(project.timezone);
  const [form, setForm] = useState({ name: '', trade: '', date: '', time: '15:00' });

  const columns: DataTableColumn<TenderPackage>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (p) => p.number,
      cell: (p) => (
        <Link
          className="link u-mono"
          href={webRoutes.tenderPackage(org.orgSlug, project.projectId, p.id)}
        >
          {formatPackageNumber(p.number)}
        </Link>
      ),
    },
    { id: 'name', header: 'Package', sortValue: (p) => p.name, cell: (p) => p.name },
    { id: 'trade', header: 'Trade', sortValue: (p) => p.trade, cell: (p) => p.trade },
    {
      id: 'status',
      header: 'Status',
      sortValue: (p) => p.status,
      cell: (p) => (
        <StatusPill
          tone={p.status === 'awarded' ? 'success' : p.status === 'draft' ? 'neutral' : 'info'}
        >
          {PACKAGE_STATUS_LABELS[p.status]}
        </StatusPill>
      ),
    },
    {
      id: 'invites',
      header: 'Quotes',
      align: 'end',
      cell: (p) =>
        `${p.invites.filter((i) => i.status === 'submitted').length} of ${p.invites.length}`,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (p) => p.dueAt,
      cell: (p) => formatInstant(p.dueAt, project.timezone),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Estimating"
        title="Tender packages"
        description="Send scope to subcontractors, read their quotes with Nova and compare like for like."
        actions={
          <Button
            onClick={() => {
              setForm({ name: '', trade: '', date: dueInBusinessDays(today, 10), time: '15:00' });
              setOpen(true);
            }}
          >
            <Plus size={16} aria-hidden="true" /> New package
          </Button>
        }
      />
      <PreviewDataNotice tool="Estimating" />
      <ErrorAlert error={packages.error} title="We couldn't load tender packages" />
      {packages.isPending ? (
        <SkeletonRows label="Loading packages…" />
      ) : (
        <DataTable
          caption="Tender packages"
          columns={columns}
          rows={packages.data ?? []}
          getRowId={(p) => p.id}
          defaultSort={{ columnId: 'number', direction: 'asc' }}
          empty={
            <EmptyState
              icon={EstimatingIcon}
              title="No tender packages yet"
              description="Create one per trade, then add scope lines and invite subcontractors."
            />
          }
        />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New tender package"
        description={`Due time is in the project's time zone (${project.timezone}).`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.name.trim() || !form.trade.trim() || !form.date || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name,
                    trade: form.trade,
                    dueAt: zonedToUtc(
                      form.date,
                      form.time || '15:00',
                      project.timezone,
                    ).toISOString(),
                  },
                  {
                    onSuccess: (p) => {
                      setOpen(false);
                      router.push(
                        `${webRoutes.tenderPackage(org.orgSlug, project.projectId, p.id)}?tab=scope`,
                      );
                    },
                  },
                )
              }
            >
              Create package
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="Trade"
            value={form.trade}
            onChange={(e) => setForm({ ...form, trade: e.target.value })}
          />
          <div className="form-row">
            <TextField
              label="Due date"
              type="date"
              min={today}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <TextField
              label="Due time"
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </div>
          <ErrorAlert error={create.error} title="We couldn't create the package" />
        </div>
      </Dialog>
    </div>
  );
}
