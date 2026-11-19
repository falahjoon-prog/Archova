'use client';

import { useEffect, useState } from 'react';
import { atLeast } from '@archova/domain/permissions';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { HandoverIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { LocalDate } from '@archova/time';
import { useHandoverExport, useHandoverMutations, useHandoverPack } from '../hooks/useHandover';
import {
  ACTION_LABELS,
  CATEGORIES,
  CATEGORY_LABELS,
  STATES,
  STATE_LABELS,
  availableActions,
  exportCsv,
  type HandoverAction,
  type HandoverCategory,
  type HandoverInput,
  type HandoverItem,
  type HandoverState,
} from '../lib/types';

const STATE_TONE: Record<HandoverState, StatusTone> = {
  outstanding: 'neutral',
  requested: 'info',
  received: 'warning',
  approved: 'success',
  not_applicable: 'neutral',
  overdue: 'danger',
};

const day = (d: string | null) => (d ? formatLocalDate(d as LocalDate) : '—');

/** The project's close-out checklist: what the client is owed at completion, what has arrived, what Nova would chase. */
export function HandoverScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const canManage =
    org.role === 'owner' ||
    org.role === 'admin' ||
    atLeast(perms.data?.toolLevels.documents, 'admin');
  const [params, setParams] = useUrlState(['state', 'category'] as const);
  const state = STATES.includes(params.state as HandoverState)
    ? (params.state as HandoverState)
    : undefined;
  const category = CATEGORIES.includes(params.category as HandoverCategory)
    ? (params.category as HandoverCategory)
    : undefined;
  const pack = useHandoverPack();
  const m = useHandoverMutations();
  const [editing, setEditing] = useState<HandoverItem | 'new' | null>(null);
  const [receiving, setReceiving] = useState<HandoverItem | null>(null);
  const [noting, setNoting] = useState<{ item: HandoverItem; action: HandoverAction } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [exporting, setExporting] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'handover', id: 'checklist' },
  });

  const data = pack.data;
  const items = (data?.items ?? []).filter(
    (i) => (!state || i.state === state) && (!category || i.category === category),
  );
  const filtered = Boolean(state || category);

  const act = (item: HandoverItem, action: HandoverAction) => {
    if (action === 'receive') setReceiving(item);
    else if (action === 'reject' || action === 'markNotApplicable') setNoting({ item, action });
    else m.transition.mutate({ item, input: { action } });
  };

  const columns: DataTableColumn<HandoverItem>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (i) => i.numberLabel,
      cell: (i) => i.numberLabel,
    },
    {
      id: 'title',
      header: 'Item',
      sortValue: (i) => i.title,
      cell: (i) => (
        <>
          {i.title}
          <div className="u-muted">
            {CATEGORY_LABELS[i.category]}
            {!i.required ? ' · Optional' : ''}
          </div>
          {i.note && (i.status === 'requested' || i.status === 'not_applicable') ? (
            <div className="u-muted">{i.note}</div>
          ) : null}
        </>
      ),
    },
    {
      id: 'responsible',
      header: 'Responsible',
      cell: (i) => (i.responsibleCompanyId ? dir.companyName(i.responsibleCompanyId) : '—'),
    },
    { id: 'due', header: 'Due', sortValue: (i) => i.dueOn, cell: (i) => day(i.dueOn) },
    {
      id: 'files',
      header: 'Files',
      sortValue: (i) => i.fileIds.length,
      cell: (i) => i.fileIds.length,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => i.state,
      cell: (i) => <StatusPill tone={STATE_TONE[i.state]}>{STATE_LABELS[i.state]}</StatusPill>,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (i: HandoverItem) => (
              <span className="row-actions">
                {availableActions(i.status)
                  .slice(0, 1)
                  .map((a) => (
                    <Button
                      key={a}
                      variant="tertiary"
                      disabled={m.transition.isPending}
                      aria-label={`${ACTION_LABELS[a]} ${i.numberLabel}`}
                      onClick={() => act(i, a)}
                    >
                      {ACTION_LABELS[a]}
                    </Button>
                  ))}
                <Button
                  variant="tertiary"
                  aria-label={`Edit ${i.numberLabel}`}
                  onClick={() => setEditing(i)}
                >
                  Edit
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<HandoverItem>,
        ]
      : []),
  ];

  const s = data?.summary;
  return (
    <>
      <PageHeader
        eyebrow="Documents and close-out"
        title="Handover and close-out"
        description="Everything the client is owed at completion: as-built drawings, O&M manuals, warranties, certificates, defect sign-off and keys. Nova flags what is missing or stuck, and you issue one pack to the client when it is ready."
        actions={
          <>
            <Button variant="secondary" onClick={() => setExporting(true)}>
              Client copy
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => setIssuing(true)}>
                  Issue to client
                </Button>
                <Button onClick={() => setEditing('new')}>
                  <Plus size={16} aria-hidden="true" /> Add item
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Handover" /> : null}
      <ErrorAlert error={m.transition.error} title="We couldn't update that item" />
      <ErrorAlert error={pack.error} title="We couldn't load the handover checklist" />
      {s && s.total > 0 ? (
        <StatGrid
          items={[
            {
              label: 'Required items complete',
              value: `${s.percentComplete}%`,
              hint: `${s.requiredComplete} of ${s.required} required`,
              tone: data?.readyToIssue ? 'success' : undefined,
            },
            {
              label: 'Waiting for approval',
              value: s.received,
              tone: s.received > 0 ? 'warning' : undefined,
            },
            { label: 'Overdue', value: s.overdue, tone: s.overdue > 0 ? 'danger' : undefined },
            {
              label: 'Issued to client',
              value: data?.issues.length ?? 0,
              hint: data?.issues[0]
                ? `Last ${day(data.issues[0].issuedAt.slice(0, 10))}`
                : 'Not yet',
            },
          ]}
        />
      ) : null}
      {(data?.flags ?? []).length > 0 ? (
        <Card title="Needs attention" actions={<StatusPill tone="ai">Nova flags</StatusPill>}>
          <ul className="plain-list">
            {(data?.flags ?? []).map((f, i) => {
              const target = f.itemId ? data?.items.find((x) => x.id === f.itemId) : undefined;
              return (
                <li key={`${f.kind}-${f.itemId ?? i}`}>
                  <Alert
                    tone={
                      f.severity === 'high' ? 'danger' : f.severity === 'warn' ? 'warning' : 'info'
                    }
                    title={f.title}
                    action={
                      canManage && f.kind === 'empty_checklist' ? (
                        <Button
                          variant="secondary"
                          disabled={m.applyTemplate.isPending}
                          onClick={() => m.applyTemplate.mutate()}
                        >
                          Use the standard list
                        </Button>
                      ) : canManage && target && f.kind === 'awaiting_approval' ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            m.transition.mutate({ item: target, input: { action: 'approve' } })
                          }
                        >
                          Approve
                        </Button>
                      ) : canManage &&
                        target &&
                        f.kind === 'overdue' &&
                        target.status === 'outstanding' ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            m.transition.mutate({ item: target, input: { action: 'request' } })
                          }
                        >
                          Request now
                        </Button>
                      ) : canManage && target ? (
                        <Button variant="secondary" onClick={() => setEditing(target)}>
                          Edit
                        </Button>
                      ) : undefined
                    }
                  >
                    {f.detail}
                  </Alert>
                </li>
              );
            })}
          </ul>
          <ErrorAlert error={m.applyTemplate.error} title="We couldn't add the standard list" />
        </Card>
      ) : null}
      {s && s.byCategory.length > 0 ? (
        <Card title="By category">
          <ul className="plain-list">
            {s.byCategory.map((c) => (
              <li key={c.category} className="row-end">
                <span>{CATEGORY_LABELS[c.category]}</span>
                <span className="u-muted">
                  {c.complete} of {c.total} complete
                  {c.requiredOutstanding > 0 ? `, ${c.requiredOutstanding} required to go` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <FilterBar label="Filter checklist">
        <Select
          label="Status"
          value={params.state}
          placeholder="Any status"
          options={STATES.map((v) => ({ value: v, label: STATE_LABELS[v] }))}
          onChange={(e) => setParams({ state: e.target.value })}
        />
        <Select
          label="Category"
          value={params.category}
          placeholder="Any category"
          options={CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABELS[v] }))}
          onChange={(e) => setParams({ category: e.target.value })}
        />
      </FilterBar>
      {pack.isPending ? (
        <SkeletonRows label="Loading the checklist…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={HandoverIcon}
          title={filtered ? 'No items match' : 'No handover checklist yet'}
          description={
            filtered
              ? 'Try different filters.'
              : 'Start from the standard Australian close-out list, then add or remove items to suit the project.'
          }
          action={
            !filtered && canManage ? (
              <Button disabled={m.applyTemplate.isPending} onClick={() => m.applyTemplate.mutate()}>
                Use the standard list
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption="Handover checklist"
          columns={columns}
          rows={items}
          getRowId={(i) => i.id}
        />
      )}
      {editing ? (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          dir={dir}
          onAction={(item, action) => {
            setEditing(null);
            act(item, action);
          }}
          pending={m.create.isPending || m.update.isPending}
          error={m.create.error ?? m.update.error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === 'new'
              ? m.create.mutate(input, { onSuccess: () => setEditing(null) })
              : m.update.mutate({ item: editing, input }, { onSuccess: () => setEditing(null) })
          }
        />
      ) : null}
      {receiving ? (
        <ReceiveDialog
          item={receiving}
          pending={m.receive.isPending}
          error={m.receive.error}
          onClose={() => setReceiving(null)}
          onSave={(files) =>
            m.receive.mutate({ item: receiving, files }, { onSuccess: () => setReceiving(null) })
          }
        />
      ) : null}
      {noting ? (
        <NoteDialog
          item={noting.item}
          action={noting.action}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setNoting(null)}
          onSave={(note) =>
            m.transition.mutate(
              { item: noting.item, input: { action: noting.action, note } },
              { onSuccess: () => setNoting(null) },
            )
          }
        />
      ) : null}
      {issuing ? (
        <IssueDialog
          incomplete={(s?.required ?? 0) - (s?.requiredComplete ?? 0)}
          pending={m.issue.isPending}
          error={m.issue.error}
          onClose={() => setIssuing(false)}
          onSave={(v) => m.issue.mutate(v, { onSuccess: () => setIssuing(false) })}
        />
      ) : null}
      {exporting ? <ExportDialog onClose={() => setExporting(false)} /> : null}
    </>
  );
}

function ItemDialog({
  item,
  dir,
  onAction,
  pending,
  error,
  onClose,
  onSave,
}: {
  item: HandoverItem | null;
  dir: ReturnType<typeof useProjectDirectory>;
  onAction: (item: HandoverItem, action: HandoverAction) => void;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: HandoverInput) => void;
}) {
  const [category, setCategory] = useState<HandoverCategory>(item?.category ?? 'om_manual');
  const [title, setTitle] = useState(item?.title ?? '');
  const [required, setRequired] = useState(item?.required ?? true);
  const [company, setCompany] = useState(item?.responsibleCompanyId ?? '');
  const [due, setDue] = useState(item?.dueOn ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? `Edit ${item.numberLabel}` : 'Add handover item'}
      description="Name what the client is owed and who supplies it. Archova tracks what has arrived and chases what has not."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                category,
                title: title.trim(),
                required,
                responsibleCompanyId: company || null,
                dueOn: due || null,
                description: description.trim() || null,
              })
            }
          >
            {pending ? 'Saving…' : item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Category"
          value={category}
          options={CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABELS[v] }))}
          onChange={(e) => setCategory(e.target.value as HandoverCategory)}
        />
        <TextField label="Item" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Checkbox
          label="Required before the pack can be issued"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        <Select
          label="Responsible company"
          value={company}
          placeholder="Nobody yet"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <TextField label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Textarea
          label="Details"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {item && availableActions(item.status).length > 1 ? (
          <div className="row-actions">
            {availableActions(item.status)
              .slice(1)
              .map((a) => (
                <Button key={a} variant="secondary" onClick={() => onAction(item, a)}>
                  {ACTION_LABELS[a]}
                </Button>
              ))}
          </div>
        ) : null}
        <ErrorAlert error={error} title="We couldn't save the item" />
      </div>
    </Dialog>
  );
}

function ReceiveDialog({
  item,
  pending,
  error,
  onClose,
  onSave,
}: {
  item: HandoverItem;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (files: File[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const hasFiles = item.fileIds.length > 0 || files.length > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mark ${item.numberLabel} received`}
      description={`${item.title}. Attach the document or documents that came in; an item can't be marked received without one.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!hasFiles || pending} onClick={() => onSave(files)}>
            {pending ? 'Uploading…' : 'Mark received'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {item.fileIds.length > 0 ? (
          <p className="u-muted">
            {item.fileIds.length} file{item.fileIds.length === 1 ? '' : 's'} already attached.
          </p>
        ) : null}
        <label className="stack">
          <span>Files</span>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        <ErrorAlert error={error} title="We couldn't mark it received" />
      </div>
    </Dialog>
  );
}

function NoteDialog({
  item,
  action,
  pending,
  error,
  onClose,
  onSave,
}: {
  item: HandoverItem;
  action: HandoverAction;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const sendBack = action === 'reject';
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${ACTION_LABELS[action]} ${item.numberLabel}`}
      description={
        sendBack
          ? 'The item goes back to requested with your note, so the supplier knows what to fix.'
          : 'Say why this does not apply to the project. The reason is kept on the item.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!note.trim() || pending} onClick={() => onSave(note.trim())}>
            {pending ? 'Saving…' : ACTION_LABELS[action]}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea
          label={sendBack ? 'What needs fixing' : 'Reason'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't update the item" />
      </div>
    </Dialog>
  );
}

function IssueDialog({
  incomplete,
  pending,
  error,
  onClose,
  onSave,
}: {
  incomplete: number;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (v: { recipientName: string; note?: string; acknowledgeIncomplete?: boolean }) => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Issue the pack to the client"
      description="This records that the pack went to the client today, and keeps a frozen copy of the checklist as it stands. It doesn't send anything: use Client copy to download what you are sending."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!recipient.trim() || (incomplete > 0 && !ack) || pending}
            onClick={() =>
              onSave({
                recipientName: recipient.trim(),
                ...(note.trim() ? { note: note.trim() } : {}),
                ...(incomplete > 0 ? { acknowledgeIncomplete: true } : {}),
              })
            }
          >
            {pending ? 'Recording…' : 'Record issue'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {incomplete > 0 ? (
          <Alert
            tone="warning"
            title={`${incomplete} required item${incomplete === 1 ? ' is' : 's are'} not complete`}
          >
            You can still issue the pack. The copy will show what was outstanding.
          </Alert>
        ) : null}
        <TextField
          label="Issued to"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        {incomplete > 0 ? (
          <Checkbox
            label="Issue it with the outstanding items"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
        ) : null}
        <ErrorAlert error={error} title="We couldn't record the issue" />
      </div>
    </Dialog>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const exp = useHandoverExport();
  const { mutate } = exp;
  useEffect(() => mutate(), [mutate]);
  const data = exp.data;
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([exportCsv(data)], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `handover-index-${data.projectName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Client copy"
      description="An index of every item and the files behind it, for the client. Download it as a spreadsheet to send with the documents."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!data} onClick={download}>
            Download CSV
          </Button>
        </>
      }
    >
      <div className="stack">
        {exp.isPending ? <SkeletonRows label="Preparing the client copy…" /> : null}
        <ErrorAlert error={exp.error} title="We couldn't prepare the client copy" />
        {data ? (
          <>
            <p>
              <strong>{data.projectName}</strong>
              <span className="u-muted">
                {' '}
                · {data.summary.requiredComplete} of {data.summary.required} required items complete
              </span>
            </p>
            <ul className="plain-list">
              {data.items.map((i) => (
                <li key={i.numberLabel} className="row-end">
                  <span>
                    {i.numberLabel} {i.title}
                  </span>
                  <span className="u-muted">
                    {STATE_LABELS[i.status]} · {i.files.length} file
                    {i.files.length === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
