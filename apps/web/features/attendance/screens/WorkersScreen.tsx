'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { AttendanceIcon, ChevronLeft, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useWorkerMutations, useWorkers } from '../hooks/useAttendance';
import { KIND_LABELS, type Worker, type WorkerInput, type WorkerKind } from '../lib/types';

const KINDS = Object.keys(KIND_LABELS) as WorkerKind[];

/** Workers, visitors and delivery drivers (ATT-AC2): add people, and confirm a company typed at the gate. */
export function WorkersScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const [params, setParams] = useUrlState(['q', 'kind', 'company'] as const);
  const kind = KINDS.includes(params.kind as WorkerKind) ? (params.kind as WorkerKind) : undefined;
  const workers = useWorkers({
    q: params.q || undefined,
    kind,
    companyId: params.company || undefined,
  });
  const m = useWorkerMutations();
  const [editing, setEditing] = useState<Worker | 'new' | null>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'attendance', id: 'workers' },
  });

  const companyOptions = dir.companies
    .filter((c) => dir.onProject(c.id))
    .map((c) => ({ value: c.id, label: c.name }));
  const filtered = Object.values(params).some(Boolean);

  const columns: DataTableColumn<Worker>[] = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortValue: (w) => w.fullName,
      cell: (w) => (
        <>
          {w.fullName}
          {w.kind !== 'worker' ? <span className="u-caption"> · {KIND_LABELS[w.kind]}</span> : null}
        </>
      ),
    },
    {
      id: 'company',
      header: 'Company',
      sortValue: (w) => (w.companyId ? dir.companyName(w.companyId) : (w.companyNameOther ?? '')),
      cell: (w) =>
        w.companyId ? (
          dir.companyName(w.companyId)
        ) : w.companyNameOther ? (
          <>
            {w.companyNameOther} <StatusPill tone="warning">Not confirmed</StatusPill>
          </>
        ) : (
          '—'
        ),
    },
    { id: 'phone', header: 'Phone', cell: (w) => w.phone ?? '—' },
    {
      id: 'status',
      header: 'Sign-in access',
      sortValue: (w) => w.status,
      cell: (w) =>
        w.status === 'active' ? (
          <StatusPill tone="success">On</StatusPill>
        ) : (
          <StatusPill tone="neutral">Off</StatusPill>
        ),
    },
    {
      id: 'actions',
      header: <span className="u-visually-hidden">Actions</span>,
      cell: (w) => (
        <span className="row-actions">
          <Button
            variant="tertiary"
            aria-label={`${!w.companyId && w.companyNameOther ? 'Confirm company' : 'Edit'} ${w.fullName}`}
            onClick={() => setEditing(w)}
          >
            {!w.companyId && w.companyNameOther ? 'Confirm company' : 'Edit'}
          </Button>
          <Button
            variant="tertiary"
            aria-label={`${w.status === 'active' ? 'Switch off' : 'Switch on'} sign-in for ${w.fullName}`}
            disabled={m.update.isPending}
            onClick={() =>
              m.update.mutate({
                worker: w,
                patch: { status: w.status === 'active' ? 'inactive' : 'active' },
              })
            }
          >
            {w.status === 'active' ? 'Switch off' : 'Switch on'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Workforce"
        title="Workers"
        description="People who sign in at the gate. Confirm companies typed at the gate so their hours count to the right company."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendance(org.orgSlug, project.projectId)}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Attendance
            </Link>
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} aria-hidden="true" /> Add worker
            </Button>
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Workers" /> : null}
      <FilterBar label="Filter workers">
        <TextField
          label="Search"
          type="search"
          value={params.q}
          placeholder="Name"
          onChange={(e) => setParams({ q: e.target.value })}
        />
        <Select
          label="Type"
          value={params.kind}
          placeholder="Anyone"
          options={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          onChange={(e) => setParams({ kind: e.target.value })}
        />
        <Select
          label="Company"
          value={params.company}
          placeholder="All companies"
          options={companyOptions}
          onChange={(e) => setParams({ company: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert
        error={workers.error ?? m.update.error}
        title="Something went wrong with workers"
      />
      {workers.isPending ? (
        <SkeletonRows label="Loading workers…" />
      ) : (
        <DataTable
          caption="Workers"
          columns={columns}
          rows={workers.data ?? []}
          getRowId={(w) => w.id}
          defaultSort={{ columnId: 'name', direction: 'asc' }}
          empty={
            <EmptyState
              icon={AttendanceIcon}
              title={filtered ? 'No workers match these filters' : 'No workers yet'}
              description={
                filtered
                  ? 'Try a different name, type or company.'
                  : 'People appear here when they sign in, or you can add them.'
              }
            />
          }
        />
      )}
      {editing ? (
        <WorkerDialog
          key={editing === 'new' ? 'new' : editing.id}
          worker={editing === 'new' ? null : editing}
          companies={companyOptions}
          pending={m.create.isPending || m.update.isPending}
          error={m.create.error ?? m.update.error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === 'new'
              ? m.create.mutate(input, { onSuccess: () => setEditing(null) })
              : m.update.mutate(
                  { worker: editing, patch: input },
                  { onSuccess: () => setEditing(null) },
                )
          }
        />
      ) : null}
    </>
  );
}

function WorkerDialog({
  worker,
  companies,
  pending,
  error,
  onClose,
  onSave,
}: {
  worker: Worker | null;
  companies: Array<{ value: string; label: string }>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: WorkerInput) => void;
}) {
  const [fullName, setFullName] = useState(worker?.fullName ?? '');
  const [companyId, setCompanyId] = useState(worker?.companyId ?? '');
  const [other, setOther] = useState(worker?.companyNameOther ?? '');
  const [phone, setPhone] = useState(worker?.phone ?? '');
  const [email, setEmail] = useState(worker?.email ?? '');
  const [kind, setKind] = useState<WorkerKind>(worker?.kind ?? 'worker');
  const confirming = worker !== null && !worker.companyId && worker.companyNameOther !== null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        worker
          ? confirming
            ? `Confirm company for ${worker.fullName}`
            : `Edit ${worker.fullName}`
          : 'Add worker'
      }
      description={
        confirming
          ? `They typed “${worker.companyNameOther}” at the gate. Pick the company from the directory to confirm it.`
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!fullName.trim() || pending}
            onClick={() =>
              onSave({
                fullName: fullName.trim(),
                companyId: companyId || null,
                companyNameOther: companyId ? null : other.trim() || null,
                phone: phone.trim() || null,
                email: email.trim() || null,
                kind,
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Select
          label="Company"
          value={companyId}
          placeholder="Not in the directory"
          options={companies}
          onChange={(e) => setCompanyId(e.target.value)}
        />
        {companyId ? null : (
          <TextField
            label="Company name if not in the directory"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
        )}
        <TextField
          label="Mobile"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select
          label="Type"
          value={kind}
          options={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          onChange={(e) => setKind(e.target.value as WorkerKind)}
        />
        <ErrorAlert error={error} title="We couldn't save the worker" />
      </div>
    </Dialog>
  );
}
