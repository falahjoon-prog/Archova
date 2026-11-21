'use client';

import { useState } from 'react';
import type { ItpItem, ItpPackageSummary } from '@archova/contracts';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { DocumentsIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  useActivateItp,
  useCreateItp,
  useItpDocuments,
  useItpPackage,
  useItpPackages,
  useSignItpItem,
} from '../hooks/useItp';

const STATUS_LABELS = { draft: 'Draft', active: 'In progress', complete: 'Complete' } as const;
const STATUS_TONES: Record<ItpPackageSummary['package']['status'], StatusTone> = {
  draft: 'neutral',
  active: 'info',
  complete: 'success',
};
const POINT_LABELS = {
  hold: 'Hold point',
  witness: 'Witness point',
  surveillance: 'Surveillance',
} as const;
const ITEM_TONES: Record<ItpItem['status'], StatusTone> = {
  pending: 'neutral',
  passed: 'success',
  failed: 'danger',
  waived: 'warning',
};
const ITEM_LABELS: Record<ItpItem['status'], string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  waived: 'Waived',
};

/** Inspection and test plan packages, tied to the document the work is built against. */
export function ItpScreen() {
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'documents', id: 'itp' },
  });
  const [params, setParams] = useUrlState(['itp'] as const);
  const list = useItpPackages(project.projectId);
  const [creating, setCreating] = useState(false);

  const columns: DataTableColumn<ItpPackageSummary>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (r) => r.package.number,
      cell: (r) => <span className="u-mono">{r.package.number}</span>,
    },
    {
      id: 'name',
      header: 'Name',
      sortValue: (r) => r.package.name,
      cell: (r) => (
        <button
          type="button"
          className="link-button"
          onClick={() => setParams({ itp: r.package.id })}
        >
          {r.package.name}
        </button>
      ),
    },
    { id: 'discipline', header: 'Discipline', cell: (r) => r.package.discipline ?? '—' },
    {
      id: 'progress',
      header: 'Progress',
      sortValue: (r) => (r.progress.total ? r.progress.done / r.progress.total : 0),
      cell: (r) =>
        `${r.progress.done} of ${r.progress.total}${r.progress.failed ? ` · ${r.progress.failed} failed` : ''}`,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.package.status,
      cell: (r) => (
        <StatusPill tone={STATUS_TONES[r.package.status]}>
          {STATUS_LABELS[r.package.status]}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Inspection and test plans"
        description="The hold, witness and surveillance points for each piece of work, signed off in order against the approved document."
        actions={<Button onClick={() => setCreating(true)}>New ITP</Button>}
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inspection and test plans" /> : null}
      <ErrorAlert error={list.error} title="We couldn't load ITPs" />
      {list.isPending ? (
        <SkeletonRows label="Loading ITPs…" />
      ) : (
        <DataTable
          caption="ITP packages"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(r) => r.package.id}
          defaultSort={{ columnId: 'number', direction: 'desc' }}
          empty={
            <EmptyState
              icon={DocumentsIcon}
              title="No ITPs yet"
              description="Create one for a trade package. Nova fills in starter points for the discipline."
            />
          }
        />
      )}
      {params.itp ? <ItpDetail itpId={params.itp} /> : null}
      <CreateItpDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => setParams({ itp: id })}
      />
    </div>
  );
}

function ItpDetail({ itpId }: { itpId: string }) {
  const project = useCurrentProject();
  const detail = useItpPackage(project.projectId, itpId);
  const activate = useActivateItp(project.projectId);
  const sign = useSignItpItem(project.projectId);
  const [pending, setPending] = useState<{ item: ItpItem; status: 'failed' | 'waived' } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const d = detail.data;
  if (detail.isPending) return <SkeletonRows label="Loading ITP…" />;
  if (!d) return <ErrorAlert error={detail.error} title="We couldn't load that ITP" />;
  const active = d.package.status !== 'draft';
  const firstOpenHold = d.items.find(
    (i) => i.pointType === 'hold' && i.status !== 'passed' && i.status !== 'waived',
  );

  const columns: DataTableColumn<ItpItem>[] = [
    { id: 'sort', header: '#', rowHeader: true, cell: (i) => i.sort },
    {
      id: 'desc',
      header: 'Point',
      cell: (i) => (
        <span>
          {i.description}
          {i.acceptanceCriteria ? (
            <span className="u-caption"> · {i.acceptanceCriteria}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: (i) => (
        <StatusPill tone={i.pointType === 'hold' ? 'warning' : 'neutral'}>
          {POINT_LABELS[i.pointType]}
        </StatusPill>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (i) => (
        <span>
          <StatusPill tone={ITEM_TONES[i.status]}>{ITEM_LABELS[i.status]}</StatusPill>
          {i.signedByName && i.signedAt ? (
            <span className="u-caption">
              {' '}
              {i.signedByName} · {formatInstant(i.signedAt, project.timezone)}
            </span>
          ) : null}
          {i.note ? <span className="u-caption"> · {i.note}</span> : null}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="u-visually-hidden">Actions</span>,
      cell: (i) =>
        active ? (
          <div className="row-actions">
            {i.status !== 'passed' ? (
              <Button
                size="sm"
                disabled={
                  sign.isPending || (firstOpenHold !== undefined && firstOpenHold.sort < i.sort)
                }
                onClick={() => sign.mutate({ itpId, itemId: i.id, status: 'passed', note: null })}
              >
                Pass
              </Button>
            ) : null}
            {i.status !== 'failed' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPending({ item: i, status: 'failed' })}
              >
                Fail
              </Button>
            ) : null}
            {i.status !== 'waived' ? (
              <Button
                size="sm"
                variant="tertiary"
                onClick={() => setPending({ item: i, status: 'waived' })}
              >
                Waive
              </Button>
            ) : null}
            {i.status !== 'pending' ? (
              <Button
                size="sm"
                variant="tertiary"
                onClick={() => sign.mutate({ itpId, itemId: i.id, status: 'pending', note: null })}
              >
                Reset
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <section aria-labelledby="itp-detail" className="ac-card stack">
      <div className="row-actions">
        <h2 id="itp-detail" className="panel-heading">
          {d.package.number} {d.package.name}
        </h2>
        <StatusPill tone={STATUS_TONES[d.package.status]}>
          {STATUS_LABELS[d.package.status]}
        </StatusPill>
        {d.document ? (
          <StatusPill
            tone={
              d.document.status === 'approved' || d.document.status === 'for_construction'
                ? 'success'
                : 'warning'
            }
          >
            {`${d.document.docNumber ?? d.document.title}: ${d.document.status.replace('_', ' ')}`}
          </StatusPill>
        ) : null}
      </div>
      <ErrorAlert error={activate.error ?? sign.error} title="We couldn't update the ITP" />
      {d.package.status === 'draft' ? (
        <div className="row-actions">
          <Button loading={activate.isPending} onClick={() => activate.mutate(itpId)}>
            Start work
          </Button>
          <span className="u-caption">
            {d.document
              ? 'Work can start once the linked document is approved or for construction.'
              : 'Points are signed in order once work starts.'}
          </span>
        </div>
      ) : null}
      <DataTable
        caption="ITP points"
        columns={columns}
        rows={d.items}
        getRowId={(i) => i.id}
        empty={<EmptyState title="No points" description="Add points before starting work." />}
      />
      <Dialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setNote('');
        }}
        title={pending?.status === 'failed' ? 'Fail this point' : 'Waive this point'}
        description="Say why. It is kept with the sign-off."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPending(null);
                setNote('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant={pending?.status === 'failed' ? 'danger' : 'primary'}
              loading={sign.isPending}
              disabled={!note.trim()}
              onClick={() =>
                pending &&
                sign.mutate(
                  { itpId, itemId: pending.item.id, status: pending.status, note: note.trim() },
                  {
                    onSuccess: () => {
                      setPending(null);
                      setNote('');
                    },
                  },
                )
              }
            >
              Confirm
            </Button>
          </>
        }
      >
        <Textarea label="Reason" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Dialog>
    </section>
  );
}

function CreateItpDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const project = useCurrentProject();
  const create = useCreateItp(project.projectId);
  const docs = useItpDocuments(project.projectId, open);
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [fromTemplate, setFromTemplate] = useState('yes');
  const reset = () => {
    setName('');
    setDiscipline('');
    setDocumentId('');
    setFromTemplate('yes');
  };
  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New ITP"
      description="Tie it to the document the work is built against, so work can only start once that is approved."
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() =>
              create.mutate(
                {
                  name: name.trim(),
                  discipline: discipline.trim() || null,
                  documentId: documentId || null,
                  fromTemplate: fromTemplate === 'yes',
                },
                {
                  onSuccess: (x) => {
                    reset();
                    onClose();
                    onCreated((x as { package: { id: string } }).package.id);
                  },
                },
              )
            }
          >
            Create ITP
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="Discipline"
        value={discipline}
        onChange={(e) => setDiscipline(e.target.value)}
        hint="Concrete, waterproofing and fire have tailored starter points."
      />
      <Select
        label="Document"
        placeholder="Not tied to a document"
        value={documentId}
        onChange={(e) => setDocumentId(e.target.value)}
        options={(docs.data ?? []).map((d) => ({ value: d.id, label: d.label }))}
      />
      <Select
        label="Starter points"
        value={fromTemplate}
        onChange={(e) => setFromTemplate(e.target.value)}
        options={[
          { value: 'yes', label: 'Fill from Nova’s starter for the discipline' },
          { value: 'no', label: 'Start empty' },
        ]}
      />
      <ErrorAlert error={create.error} />
    </Dialog>
  );
}
