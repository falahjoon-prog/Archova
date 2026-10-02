'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { webRoutes } from '@archova/routes';
import { Alert, Button, Card, PageHeader, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useCreateDrawingSet } from '../hooks/useDrawings';
import { ISSUED_FOR, ISSUED_FOR_LABELS, type IssuedFor } from '../lib/types';

/** F1.2 step 1: drop drawings, name the set; Nova then reads each title block for review (step 2). */
export function DrawingUploadScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  const create = useCreateDrawingSet(project.projectId);
  const [name, setName] = useState('');
  const [issuedFor, setIssuedFor] = useState<IssuedFor>('for_construction');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the set a name, for example "IFC set 4".';
    if (files.length === 0) next.files = 'Choose at least one PDF.';
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate(
      { name: name.trim(), issuedFor, files },
      {
        onSuccess: (set) =>
          router.push(`${webRoutes.drawings(org.orgSlug, project.projectId)}/sets/${set.id}`),
      },
    );
  };

  return (
    <div className="stack-lg">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link className="link" href={webRoutes.drawings(org.orgSlug, project.projectId)}>
          Drawings
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Upload</span>
      </nav>
      <PageHeader
        title="Upload drawings"
        description="Drop a multi-sheet PDF or many files. Nova reads each title block, then you check and publish."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Drawing upload" /> : null}
      <Card>
        <form className="stack" onSubmit={onSubmit} noValidate>
          <div className="form-row">
            <TextField
              label="Set name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
            />
            <Select
              label="Issued for"
              value={issuedFor}
              onChange={(e) => setIssuedFor(e.target.value as IssuedFor)}
              options={ISSUED_FOR.map((v) => ({ value: v, label: ISSUED_FOR_LABELS[v] }))}
            />
          </div>
          <div className="ac-field">
            <label className="ac-field__label" htmlFor="drawing-files">
              Drawing files
            </label>
            <p className="ac-field__hint" id="drawing-files-hint">
              {previewDataOnly
                ? 'PDF. Name files like A-101_RevD.pdf and the preview reads the number and revision.'
                : // Nova reads files inline up to 150 MB until the AI worker takes over larger sets.
                  'PDF, up to 150 MB per file. Nova reads every sheet, which can take a minute for a large set.'}
            </p>
            <input
              id="drawing-files"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="file-input"
              aria-describedby={
                errors.files ? 'drawing-files-hint drawing-files-error' : 'drawing-files-hint'
              }
              aria-invalid={errors.files ? true : undefined}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {errors.files ? (
              <p className="ac-field__error" id="drawing-files-error">
                {errors.files}
              </p>
            ) : null}
          </div>
          {files.length ? (
            <Alert tone="info">
              {files.length} file{files.length === 1 ? '' : 's'} ready to read.
            </Alert>
          ) : null}
          <ErrorAlert error={create.error} title="We couldn't start the upload" />
          <div>
            <Button type="submit" loading={create.isPending}>
              Read title blocks
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
