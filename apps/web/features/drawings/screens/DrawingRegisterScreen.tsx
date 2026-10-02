'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import {
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  Switch,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { DrawingsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { RevisionBadge } from '../components/RevisionBadge';
import { useAllRevisions, useSheets } from '../hooks/useDrawings';
import {
  DISCIPLINES,
  ISSUED_FOR,
  ISSUED_FOR_LABELS,
  disciplineLabel,
  issuedForLabel,
  type Discipline,
  type DrawingRevision,
  type DrawingSheet,
  type IssuedFor,
} from '../lib/types';

const isDiscipline = (v: string): v is Discipline => v in DISCIPLINES;
const isIssuedFor = (v: string): v is IssuedFor => (ISSUED_FOR as readonly string[]).includes(v);

/** Drawing register (F1.3, DOC-AC5): current revisions by default, all revisions on a toggle. */
export function DrawingRegisterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'drawings', id: 'register' },
  });
  const [params, setParams] = useUrlState(['discipline', 'status', 'q', 'all'] as const);
  const filters = {
    discipline: isDiscipline(params.discipline) ? params.discipline : undefined,
    issuedFor: isIssuedFor(params.status) ? params.status : undefined,
    q: params.q || undefined,
  };
  const showAll = params.all === '1';
  const sheets = useSheets(project.projectId, filters);
  const all = useAllRevisions(project.projectId, showAll);

  const sheetHref = (sheetId: string, revisionId?: string) =>
    webRoutes.drawing(org.orgSlug, project.projectId, sheetId, revisionId);

  const columns: DataTableColumn<DrawingSheet>[] = [
    {
      id: 'number',
      header: 'Sheet',
      rowHeader: true,
      sortValue: (s) => s.sheetNumber,
      cell: (s) => (
        <Link className="link u-mono" href={sheetHref(s.id)}>
          {s.sheetNumber}
        </Link>
      ),
    },
    { id: 'title', header: 'Title', sortValue: (s) => s.title, cell: (s) => s.title },
    {
      id: 'discipline',
      header: 'Discipline',
      sortValue: (s) => s.discipline,
      cell: (s) => disciplineLabel(s.discipline),
    },
    {
      id: 'rev',
      header: 'Revision',
      cell: (s) => <RevisionBadge rev={s.currentRev} status="current" />,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (s) => s.currentIssuedFor,
      cell: (s) => issuedForLabel(s.currentIssuedFor),
    },
    {
      id: 'date',
      header: 'Drawing date',
      sortValue: (s) => s.currentDrawingDate,
      cell: (s) => (s.currentDrawingDate ? formatLocalDate(s.currentDrawingDate) : '—'),
    },
  ];

  type RevRow = DrawingRevision & { sheetNumber: string; title: string };
  const revColumns: DataTableColumn<RevRow>[] = [
    {
      id: 'number',
      header: 'Sheet',
      rowHeader: true,
      sortValue: (r) => `${r.sheetNumber} ${r.rev}`,
      cell: (r) => (
        <Link className="link u-mono" href={sheetHref(r.sheetId, r.id)}>
          {r.sheetNumber}
        </Link>
      ),
    },
    { id: 'title', header: 'Title', cell: (r) => r.title },
    { id: 'rev', header: 'Revision', cell: (r) => <RevisionBadge rev={r.rev} status={r.status} /> },
    { id: 'status', header: 'Status', cell: (r) => issuedForLabel(r.issuedFor) },
    {
      id: 'date',
      header: 'Drawing date',
      sortValue: (r) => r.drawingDate,
      cell: (r) => (r.drawingDate ? formatLocalDate(r.drawingDate) : '—'),
    },
  ];

  const allRows = (all.data ?? []).filter(
    (r) =>
      (!filters.issuedFor || r.issuedFor === filters.issuedFor) &&
      (!filters.discipline || r.sheetNumber.startsWith(`${filters.discipline}-`)) &&
      (!filters.q || `${r.sheetNumber} ${r.title}`.toLowerCase().includes(filters.q.toLowerCase())),
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title="Drawings"
        description="The current revision of every sheet. Superseded revisions stay viewable and are clearly marked."
        actions={
          <Link
            className={buttonClassName('primary')}
            href={`${webRoutes.drawings(org.orgSlug, project.projectId)}/upload`}
          >
            <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
            Upload drawings
          </Link>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Drawings" /> : null}
      <FilterBar
        actions={
          <Switch
            label="Show all revisions"
            checked={showAll}
            onCheckedChange={(on) => setParams({ all: on ? '1' : null })}
          />
        }
      >
        <TextField
          label="Search"
          type="search"
          value={params.q}
          onChange={(e) => setParams({ q: e.target.value })}
          placeholder="Sheet number or title"
        />
        <Select
          label="Discipline"
          placeholder="All disciplines"
          value={params.discipline}
          onChange={(e) => setParams({ discipline: e.target.value })}
          options={Object.entries(DISCIPLINES).map(([value, label]) => ({ value, label }))}
        />
        <Select
          label="Status"
          placeholder="Any status"
          value={params.status}
          onChange={(e) => setParams({ status: e.target.value })}
          options={ISSUED_FOR.map((value) => ({ value, label: ISSUED_FOR_LABELS[value] }))}
        />
      </FilterBar>
      <ErrorAlert error={sheets.error ?? all.error} title="We couldn't load the drawing register" />
      {showAll ? (
        all.isPending ? (
          <SkeletonRows label="Loading revisions…" />
        ) : (
          <DataTable
            caption="All drawing revisions"
            columns={revColumns}
            rows={allRows}
            getRowId={(r) => r.id}
            defaultSort={{ columnId: 'number', direction: 'asc' }}
            rowClassName={(r) => (r.status === 'superseded' ? 'row--muted' : undefined)}
          />
        )
      ) : sheets.isPending ? (
        <SkeletonRows label="Loading drawings…" />
      ) : (
        <DataTable
          caption="Drawing register, current revisions"
          columns={columns}
          rows={sheets.data ?? []}
          getRowId={(s) => s.id}
          defaultSort={{ columnId: 'number', direction: 'asc' }}
          empty={
            <EmptyState
              icon={DrawingsIcon}
              title="No drawings match"
              description="Clear the filters, or upload the first drawing set for this project."
            />
          }
        />
      )}
    </div>
  );
}
