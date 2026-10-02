'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { webRoutes } from '@archova/routes';
import { Alert, Button, PageHeader, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { publishBlockers } from '../data/source';
import { useDrawingSet, usePublishDrawingSet, useReviewSheetUpdate } from '../hooks/useDrawings';
import {
  issuedForLabel,
  needsCheck,
  type ReadField,
  type ReviewSheet,
  type SheetConflict,
} from '../lib/types';

const CONFLICTS: Record<
  SheetConflict,
  { tone: 'info' | 'warning' | 'danger' | 'success'; label: string } | null
> = {
  none: null,
  new_sheet: { tone: 'info', label: 'New sheet' },
  same_revision_exists: { tone: 'danger', label: 'Revision already in register' },
  older_revision: { tone: 'warning', label: 'Older than current revision' },
  duplicate_in_set: { tone: 'danger', label: 'In this set twice' },
};

type FieldKey = 'sheetNumber' | 'title' | 'rev' | 'discipline';

/**
 * F1.2 step 3-4 (DOC-AC2 to AC4): one row per detected sheet with what Nova read. Low-confidence fields are
 * highlighted and block publishing until someone touches them; conflicts are flagged before publish.
 */
export function DrawingSetReviewScreen({ setId }: { setId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  const set = useDrawingSet(project.projectId, setId);
  const update = useReviewSheetUpdate(project.projectId, setId);
  const publish = usePublishDrawingSet(project.projectId, setId);

  if (set.isPending) return <SkeletonRows label="Loading the drawing set…" />;
  if (set.isError)
    return <ErrorAlert error={set.error} title="We couldn't open this drawing set" />;

  const data = set.data;
  const blockers = publishBlockers(data);
  const published = data.status === 'published';

  const field = (row: ReviewSheet, key: FieldKey, label: string) => {
    const f: ReadField = row[key];
    const low = needsCheck(f);
    return (
      <TextField
        key={`${row.id}-${key}-${f.value}`}
        label={label}
        defaultValue={f.value}
        disabled={published}
        aiFilled={!f.touched}
        hint={
          low
            ? `Nova isn't sure (${Math.round(f.confidence * 100)}%). Check it against the sheet.`
            : undefined
        }
        className={low ? 'input--low-confidence' : undefined}
        onBlur={(e) => {
          if (e.target.value !== f.value || low)
            update.mutate({ sheetId: row.id, patch: { [key]: e.target.value } });
        }}
      />
    );
  };

  return (
    <div className="stack-lg">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link className="link" href={webRoutes.drawings(org.orgSlug, project.projectId)}>
          Drawings
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{data.name}</span>
      </nav>
      <PageHeader
        title={`Review ${data.name}`}
        description={`${data.sheets.length} sheet${data.sheets.length === 1 ? '' : 's'} · ${issuedForLabel(data.issuedFor)}`}
        actions={
          published ? (
            <Button onClick={() => router.push(webRoutes.drawings(org.orgSlug, project.projectId))}>
              Go to register
            </Button>
          ) : (
            <Button
              disabled={blockers.length > 0}
              loading={publish.isPending}
              onClick={() => publish.mutate()}
            >
              Publish {data.sheets.length} sheet{data.sheets.length === 1 ? '' : 's'}
            </Button>
          )
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Drawing upload" /> : null}
      {published ? (
        <Alert tone="success" title="Published">
          New revisions are current and the revisions they replace are marked superseded.
        </Alert>
      ) : blockers.length ? (
        <Alert tone="warning" title="Before you publish">
          <ul className="u-m-0">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success">
          Everything is checked. Publishing makes these revisions current in one step.
        </Alert>
      )}
      <ErrorAlert error={update.error ?? publish.error} />
      <ol className="review-list">
        {data.sheets.map((row) => {
          const conflict = CONFLICTS[row.conflict];
          return (
            <li key={row.id} className="review-list__item">
              <div className="review-list__head">
                <span className="u-mono">{row.fileName}</span>
                {conflict ? <StatusPill tone={conflict.tone}>{conflict.label}</StatusPill> : null}
              </div>
              <div className="review-list__fields">
                {field(row, 'sheetNumber', 'Sheet number')}
                {field(row, 'title', 'Title')}
                {field(row, 'rev', 'Revision')}
                {field(row, 'discipline', 'Discipline')}
              </div>
              {row.conflict === 'older_revision' ? (
                <TextField
                  label="Reason for publishing an older revision"
                  defaultValue={row.reason}
                  disabled={published}
                  onBlur={(e) =>
                    update.mutate({ sheetId: row.id, patch: { reason: e.target.value } })
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
