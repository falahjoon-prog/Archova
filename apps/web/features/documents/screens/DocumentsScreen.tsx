'use client';

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
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { Calendar, DocumentsIcon, Star, Trash2 } from '@archova/ui/icons';
import { fileDownloadUrl } from '@/shared/lib/uploads';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { RecycleBin } from '@/shared/layout/RecycleBin';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  useAddRevision,
  useDeleteDocument,
  useDocumentBin,
  useDocumentRevisions,
  useDocuments,
  useFolders,
  useRestoreDocument,
  useSetTracked,
} from '../hooks/useDocuments';
import {
  DOCUMENT_STATUS_LABELS,
  NEW_DOCUMENTS_DAYS,
  type DocumentsView,
  type ProjectDocument,
} from '../lib/types';

const EMPTY_FORM = { rev: '', file: null, notes: '' };

/**
 * Downloads on a short-lived signed URL; the API checks the caller can read the file. Navigating rather than
 * opening a window, which browsers block after an await.
 */
async function download(orgId: string, fileId: string) {
  window.location.assign(await fileDownloadUrl(orgId, fileId));
}

/** Non-drawing documents in folders with versions (DOC-US9). Drawings have their own register. */
export function DocumentsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'documents', id: 'register' },
  });
  const [params, setParams] = useUrlState(['folder', 'doc', 'view'] as const);
  // `view` is a sidebar shortcut: it replaces the folder choice until a folder is picked again.
  const view: DocumentsView | 'bin' =
    params.view === 'week' || params.view === 'tracked' || params.view === 'bin'
      ? params.view
      : 'all';
  const folderId = view === 'all' ? params.folder || null : null;
  const folders = useFolders(project.projectId);
  const docs = useDocuments(project.projectId, folderId, view === 'bin' ? 'all' : view);
  const bin = useDocumentBin(project.projectId, view === 'bin');
  const setTracked = useSetTracked(project.projectId);
  const deleteDoc = useDeleteDocument(project.projectId);
  const restore = useRestoreDocument(project.projectId);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);
  const selected = docs.data?.find((d) => d.id === params.doc) ?? null;
  const revisions = useDocumentRevisions(project.projectId, selected?.id ?? null);
  const addRevision = useAddRevision(project.projectId);
  const [uploading, setUploading] = useState<ProjectDocument | null>(null);
  const [form, setForm] = useState<{ rev: string; file: File | null; notes: string }>(EMPTY_FORM);

  const columns: DataTableColumn<ProjectDocument>[] = [
    {
      id: 'title',
      header: 'Title',
      rowHeader: true,
      sortValue: (d) => d.title,
      cell: (d) => (
        <button
          type="button"
          className="link-button"
          aria-pressed={d.id === selected?.id}
          onClick={() => setParams({ doc: d.id })}
        >
          {d.title}
        </button>
      ),
    },
    {
      id: 'number',
      header: 'Number',
      sortValue: (d) => d.docNumber,
      cell: (d) => <span className="u-mono">{d.docNumber ?? '—'}</span>,
    },
    {
      id: 'rev',
      header: 'Revision',
      cell: (d) => <StatusPill tone="success">Rev {d.currentRev} (current)</StatusPill>,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (d) => d.status,
      cell: (d) => DOCUMENT_STATUS_LABELS[d.status],
    },
    {
      id: 'updated',
      header: 'Updated',
      sortValue: (d) => d.updatedAt,
      cell: (d) => formatInstant(d.updatedAt, project.timezone),
    },
    {
      id: 'actions',
      header: <span className="u-visually-hidden">Actions</span>,
      cell: (d) => (
        <div className="documents-row-actions">
          <Button
            size="sm"
            variant="tertiary"
            aria-pressed={d.tracked}
            aria-label={`${d.tracked ? 'Stop tracking' : 'Track'} ${d.title}`}
            disabled={setTracked.isPending}
            onClick={() => setTracked.mutate({ documentId: d.id, tracked: !d.tracked })}
          >
            <Star aria-hidden="true" className={d.tracked ? 'icon-filled' : undefined} size={16} />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setUploading(d);
              setForm(EMPTY_FORM);
            }}
          >
            New revision
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            aria-label={`Delete ${d.title}`}
            onClick={() => setDeleting(d)}
          >
            <Trash2 aria-hidden="true" size={16} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Documents"
        description="Reports, certificates, contracts and specifications, with every version kept."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Documents" /> : null}
      <ErrorAlert error={folders.error ?? docs.error} title="We couldn't load documents" />
      <ErrorAlert
        error={setTracked.error ?? deleteDoc.error ?? restore.error}
        title="We couldn't update that document"
      />
      <div className="documents-layout">
        <nav aria-label="Folders" className="documents-folders">
          <ul className="plain-list">
            <li>
              <button
                type="button"
                className="folder-button"
                aria-current={view === 'all' && !folderId ? 'true' : undefined}
                onClick={() => setParams({ folder: null, doc: null, view: null })}
              >
                All documents
              </button>
            </li>
            {(folders.data ?? []).map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="folder-button"
                  aria-current={f.id === folderId ? 'true' : undefined}
                  onClick={() => setParams({ folder: f.id, doc: null, view: null })}
                >
                  {f.name}
                  {f.isPrivate ? <StatusPill tone="neutral">Restricted</StatusPill> : null}
                </button>
              </li>
            ))}
          </ul>
          <ul className="plain-list documents-shortcuts" aria-label="Shortcuts">
            {(
              [
                ['week', 'New documents this week', Calendar],
                ['tracked', 'Items you are tracking', Star],
                ['bin', 'Recycle bin', Trash2],
              ] as const
            ).map(([key, label, Icon]) => (
              <li key={key}>
                <button
                  type="button"
                  className="folder-button"
                  aria-current={view === key ? 'true' : undefined}
                  onClick={() => setParams({ folder: null, doc: null, view: key })}
                >
                  <span className="folder-button__label">
                    <Icon aria-hidden="true" size={16} />
                    {label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="stack">
          {view === 'bin' ? (
            <RecycleBin
              caption="Recycle bin"
              icon={DocumentsIcon}
              rows={bin.data}
              loading={bin.isPending}
              error={bin.error}
              getRowId={(d) => d.id}
              getLabel={(d) => d.title}
              restoringId={restore.isPending ? restore.variables : null}
              onRestore={(d) => restore.mutate(d.id)}
              columns={[
                { id: 'title', header: 'Title', rowHeader: true, cell: (d) => d.title },
                {
                  id: 'number',
                  header: 'Number',
                  cell: (d) => <span className="u-mono">{d.docNumber ?? '—'}</span>,
                },
                {
                  id: 'deleted',
                  header: 'Deleted',
                  cell: (d) => (d.deletedAt ? formatInstant(d.deletedAt, project.timezone) : '—'),
                },
              ]}
            />
          ) : docs.isPending ? (
            <SkeletonRows label="Loading documents…" />
          ) : (
            <DataTable
              caption="Documents"
              columns={columns}
              rows={docs.data ?? []}
              getRowId={(d) => d.id}
              defaultSort={{ columnId: 'title', direction: 'asc' }}
              empty={
                <EmptyState
                  icon={DocumentsIcon}
                  title={
                    view === 'week'
                      ? 'No new documents this week'
                      : view === 'tracked'
                        ? 'You are not tracking any documents'
                        : 'This folder is empty'
                  }
                  description={
                    view === 'week'
                      ? `Documents added in the last ${NEW_DOCUMENTS_DAYS} days show here.`
                      : view === 'tracked'
                        ? 'Select the star on a document to follow it here.'
                        : 'Upload a document to start its version history.'
                  }
                />
              }
            />
          )}
          {view !== 'bin' && selected ? (
            <section aria-labelledby="doc-history" className="ac-card">
              <h2 id="doc-history" className="panel-heading">
                Versions of {selected.title}
              </h2>
              {revisions.isPending ? (
                <SkeletonRows rows={2} />
              ) : (
                <ol className="plain-list">
                  {(revisions.data ?? []).map((r) => (
                    <li key={r.id} className="plain-list__item">
                      <div className="row-actions">
                        <strong>Rev {r.rev}</strong>
                        {r.status === 'current' ? (
                          <StatusPill tone="success">Current</StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Superseded</StatusPill>
                        )}
                        <span className="u-mono">{r.fileName}</span>
                        {r.fileId ? (
                          <Button
                            size="sm"
                            variant="tertiary"
                            aria-label={`Download Rev ${r.rev}`}
                            onClick={() => void download(org.orgId, r.fileId!)}
                          >
                            Download
                          </Button>
                        ) : null}
                      </div>
                      <span className="u-caption">
                        {[r.issuedDate ? formatLocalDate(r.issuedDate) : null, r.createdBy, r.notes]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>
      </div>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.title ?? ''}?`}
        description="It moves to the recycle bin with every version. You can restore it from there."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteDoc.isPending}
              onClick={() =>
                deleting &&
                deleteDoc.mutate(deleting, {
                  onSuccess: () => {
                    if (params.doc === deleting.id) setParams({ doc: null });
                    setDeleting(null);
                  },
                })
              }
            >
              Move to recycle bin
            </Button>
          </>
        }
      />
      <Dialog
        open={uploading !== null}
        onClose={() => setUploading(null)}
        title={`New revision of ${uploading?.title ?? ''}`}
        description="The current revision becomes superseded. Both stay in the history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setUploading(null)}>
              Cancel
            </Button>
            <Button
              loading={addRevision.isPending}
              disabled={!form.rev.trim() || !form.file}
              onClick={() =>
                uploading &&
                form.file &&
                addRevision.mutate(
                  {
                    documentId: uploading.id,
                    rev: form.rev.trim(),
                    file: form.file,
                    notes: form.notes,
                  },
                  { onSuccess: () => setUploading(null) },
                )
              }
            >
              Upload revision
            </Button>
          </>
        }
      >
        <TextField
          label="Revision"
          value={form.rev}
          onChange={(e) => setForm({ ...form, rev: e.target.value })}
        />
        <div className="ac-field">
          <label className="ac-field__label" htmlFor="doc-file">
            File
          </label>
          <input
            id="doc-file"
            type="file"
            className="file-input"
            onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
          />
        </div>
        <Textarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <ErrorAlert error={addRevision.error} />
      </Dialog>
    </div>
  );
}
