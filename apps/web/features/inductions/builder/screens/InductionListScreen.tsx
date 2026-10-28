'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Button,
  buttonClassName,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { InductionsIcon, Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useCreateInduction, useInductions } from '../hooks/useBuilder';
import { INDUCTION_STATUS, type Induction } from '../lib/types';

/** The site's inductions: one per site, edited as a draft and published as numbered versions (IND-AC1). */
export function InductionListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'inductions', id: 'list' },
  });
  const inductions = useInductions();
  const create = useCreateInduction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', validityMonths: '12' });
  const months = Number(form.validityMonths);
  const monthsValid = Number.isInteger(months) && months >= 1 && months <= 60;

  const columns: DataTableColumn<Induction>[] = [
    {
      id: 'title',
      header: 'Induction',
      rowHeader: true,
      sortValue: (i) => i.title,
      cell: (i) => (
        <Link
          className="link"
          href={webRoutes.inductionBuilder(org.orgSlug, project.projectId, i.id)}
        >
          {i.title}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => i.status,
      cell: (i) => (
        <StatusPill tone={INDUCTION_STATUS[i.status].tone}>
          {INDUCTION_STATUS[i.status].label}
        </StatusPill>
      ),
    },
    {
      id: 'version',
      header: 'Live version',
      align: 'end',
      sortValue: (i) => i.currentVersion?.number ?? 0,
      cell: (i) => (i.currentVersion ? `v${i.currentVersion.number}` : 'Not published'),
    },
    {
      id: 'validity',
      header: 'Valid for',
      align: 'end',
      sortValue: (i) => i.validityMonths,
      cell: (i) => `${i.validityMonths} months`,
    },
    {
      id: 'problems',
      header: 'Draft',
      cell: (i) =>
        i.status === 'archived'
          ? '—'
          : i.problems.length
            ? `${i.problems.length} to fix before publishing`
            : 'Ready to publish',
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Workforce"
        title="Site inductions"
        description="Write the induction workers complete before they can sign in, approve each section, then publish a version."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.inductionRegister(org.orgSlug, project.projectId)}
            >
              Induction register
            </Link>
            {inductions.data?.length === 0 ? (
              <Button
                onClick={() => {
                  setForm({ title: '', validityMonths: '12' });
                  setOpen(true);
                }}
              >
                <Plus size={16} aria-hidden="true" /> New induction
              </Button>
            ) : null}
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inductions" /> : null}
      <ErrorAlert error={inductions.error} title="We couldn't load inductions" />
      {inductions.isPending ? (
        <SkeletonRows label="Loading inductions…" />
      ) : (
        <DataTable
          caption="Site inductions"
          columns={columns}
          rows={inductions.data ?? []}
          getRowId={(i) => i.id}
          defaultSort={{ columnId: 'title', direction: 'asc' }}
          empty={
            <EmptyState
              icon={InductionsIcon}
              title="No induction for this project yet"
              description="A project has one induction. Create it, add the sections your site needs, and publish it so workers can complete it."
            />
          }
        />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New induction"
        description="You can change both later. Sections and the quiz come next."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.title.trim() || !monthsValid || create.isPending}
              onClick={() =>
                create.mutate(
                  { title: form.title.trim(), validityMonths: months },
                  {
                    onSuccess: (i) => {
                      setOpen(false);
                      router.push(webRoutes.inductionBuilder(org.orgSlug, project.projectId, i.id));
                    },
                  },
                )
              }
            >
              Create induction
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField
            label="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <TextField
            label="Valid for (months)"
            type="number"
            min={1}
            max={60}
            value={form.validityMonths}
            error={monthsValid ? undefined : 'Enter a whole number from 1 to 60.'}
            onChange={(e) => setForm({ ...form, validityMonths: e.target.value })}
          />
          <ErrorAlert error={create.error} title="We couldn't create the induction" />
        </div>
      </Dialog>
    </div>
  );
}
