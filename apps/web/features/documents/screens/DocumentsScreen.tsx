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
import { DocumentsIcon } from '@archova/ui/icons';
import { fileDownloadUrl } from '@/shared/lib/uploads';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  useAddRevision,
  useDocumentRevisions,
  useDocuments,
  useFolders,
} from '../hooks/useDocuments';
import { DOCUMENT_STATUS_LABELS, type ProjectDocument } from '../lib/types';

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
  const [params, setParams] = useUrlState(['folder', 'doc'] as const);
  const folderId = params.folder || null;
  const folders = useFolders(project.projectId);
  const docs = useDocuments(project.projectId, folderId);
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
      <div className="documents-layout">
        <nav aria-label="Folders" className="documents-folders">
          <ul className="plain-list">
            <li>
              <button
                type="button"
                className="folder-button"
                aria-current={!folderId ? 'true' : undefined}
                onClick={() => setParams({ folder: null, doc: null })}
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
                  onClick={() => setParams({ folder: f.id, doc: null })}
                >
                  {f.name}
                  {f.isPrivate ? <StatusPill tone="neutral">Restricted</StatusPill> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="stack">
          {docs.isPending ? (
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
                  title="This folder is empty"
                  description="Upload a document to start its version history."
                />
              }
            />
          )}
          {selected ? (
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
