'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  Switch,
  Tabs,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { ChevronDown, DrawingsIcon, Download, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { RevisionBadge } from '../components/RevisionBadge';
import { useAllRevisions, useDrawingSets, useSheets } from '../hooks/useDrawings';
import {
  DISCIPLINES,
  ISSUED_FOR,
  ISSUED_FOR_LABELS,
  groupByDiscipline,
  issuedForLabel,
  registerCsv,
  type Discipline,
  type DrawingRevision,
  type DrawingSetSummary,
  type DrawingSheet,
  type IssuedFor,
} from '../lib/types';

const isDiscipline = (v: string): v is Discipline => v in DISCIPLINES;
const isIssuedFor = (v: string): v is IssuedFor => (ISSUED_FOR as readonly string[]).includes(v);

const dateOf = (d: string | null) => (d ? formatLocalDate(d) : '—');

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Drawing register (F1.3, DOC-AC5): current revisions by default, all revisions on a toggle. */
export function DrawingRegisterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'drawings', id: 'register' },
  });
  const [params, setParams] = useUrlState(['discipline', 'status', 'q', 'all', 'tab'] as const);
  const filters = {
    discipline: isDiscipline(params.discipline) ? params.discipline : undefined,
    issuedFor: isIssuedFor(params.status) ? params.status : undefined,
    q: params.q || undefined,
  };
  const showAll = params.all === '1';
  const tab = params.tab === 'sets' ? 'sets' : 'current';
  const sheets = useSheets(project.projectId, filters);
  const everySheet = useSheets(project.projectId, {});
  const sets = useDrawingSets(project.projectId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const setById = useMemo(() => new Map((sets.data ?? []).map((x) => [x.id, x])), [sets.data]);
  const setFor = (s: DrawingSheet) => (s.currentSetId ? setById.get(s.currentSetId) : undefined);
  const groups = useMemo(() => groupByDiscipline(sheets.data ?? []), [sheets.data]);
  const all = useAllRevisions(project.projectId, showAll);

  const sheetHref = (sheetId: string, revisionId?: string) =>
    webRoutes.drawing(org.orgSlug, project.projectId, sheetId, revisionId);

  const columns: DataTableColumn<DrawingSheet>[] = [
    {
      id: 'number',
      header: 'Drawing no.',
      rowHeader: true,
      className: 'drw-col-no',
      sortValue: (s) => s.sheetNumber,
      cell: (s) => (
        <Link className="link u-mono" href={sheetHref(s.id)}>
          {s.sheetNumber}
        </Link>
      ),
    },
    {
      id: 'title',
      header: 'Drawing title',
      className: 'drw-col-title',
      sortValue: (s) => s.title,
      cell: (s) => s.title,
    },
    {
      id: 'rev',
      header: 'Revision',
      className: 'drw-col-rev',
      cell: (s) => <RevisionBadge rev={s.currentRev} status="current" />,
    },
    {
      id: 'status',
      header: 'Status',
      className: 'drw-col-status',
      sortValue: (s) => s.currentIssuedFor,
      cell: (s) => issuedForLabel(s.currentIssuedFor),
    },
    {
      id: 'date',
      header: 'Drawing date',
      className: 'drw-col-date',
      sortValue: (s) => s.currentDrawingDate,
      cell: (s) => dateOf(s.currentDrawingDate),
    },
    {
      id: 'received',
      header: 'Received date',
      className: 'drw-col-date',
      sortValue: (s) => setFor(s)?.receivedDate ?? null,
      cell: (s) => dateOf(setFor(s)?.receivedDate ?? null),
    },
    {
      id: 'set',
      header: 'Set',
      className: 'drw-col-set',
      sortValue: (s) => setFor(s)?.name ?? null,
      cell: (s) => setFor(s)?.name ?? '—',
    },
    {
      id: 'open',
      header: <span className="ac-visually-hidden">Open</span>,
      className: 'drw-col-open',
      cell: (s) => (
        <Link className={buttonClassName('secondary')} href={sheetHref(s.id)}>
          Open<span className="ac-visually-hidden"> {s.sheetNumber}</span>
        </Link>
      ),
    },
  ];

  const countBySet = new Map<string, number>();
  for (const s of everySheet.data ?? [])
    if (s.currentSetId) countBySet.set(s.currentSetId, (countBySet.get(s.currentSetId) ?? 0) + 1);
  const setColumns: DataTableColumn<DrawingSetSummary>[] = [
    { id: 'name', header: 'Set', rowHeader: true, sortValue: (x) => x.name, cell: (x) => x.name },
    {
      id: 'issued',
      header: 'Issued',
      sortValue: (x) => x.issuedDate,
      cell: (x) => dateOf(x.issuedDate),
    },
    {
      id: 'received',
      header: 'Received',
      sortValue: (x) => x.receivedDate,
      cell: (x) => dateOf(x.receivedDate),
    },
    {
      id: 'count',
      header: 'Current drawings',
      align: 'end',
      sortValue: (x) => countBySet.get(x.id) ?? 0,
      cell: (x) => countBySet.get(x.id) ?? 0,
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
    {
      id: 'received',
      header: 'Received date',
      cell: (r) => dateOf(setById.get(r.setId)?.receivedDate ?? null),
    },
    { id: 'set', header: 'Set', cell: (r) => setById.get(r.setId)?.name ?? '—' },
    { id: 'status', header: 'Status', cell: (r) => issuedForLabel(r.issuedFor) },
    {
      id: 'date',
      header: 'Drawing date',
      sortValue: (r) => r.drawingDate,
      cell: (r) => dateOf(r.drawingDate),
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
        description="The current revision of every sheet, grouped by discipline. Superseded revisions stay viewable and are clearly marked."
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
      <Tabs
        label="Drawing views"
        tabs={[
          { id: 'current', label: 'Current drawings' },
          { id: 'sets', label: 'Drawing sets', count: sets.data?.length },
        ]}
        value={tab}
        onValueChange={(id) => setParams({ tab: id === 'sets' ? 'sets' : null })}
      >
        {tab === 'sets' ? (
          <div className="stack-lg">
            <ErrorAlert error={sets.error} title="We couldn't load the drawing sets" />
            {sets.isPending ? (
              <SkeletonRows label="Loading drawing sets…" />
            ) : (
              <DataTable
                caption="Drawing sets"
                columns={setColumns}
                rows={sets.data ?? []}
                getRowId={(x) => x.id}
                empty={
                  <EmptyState
                    icon={DrawingsIcon}
                    title="No drawing sets yet"
                    description="Upload the first drawing set for this project."
                  />
                }
              />
            )}
          </div>
        ) : (
          <div className="stack-lg">
            <FilterBar
              actions={
                <>
                  <Switch
                    label="Show all revisions"
                    checked={showAll}
                    onCheckedChange={(on) => setParams({ all: on ? '1' : null })}
                  />
                  {!showAll ? (
                    <button
                      type="button"
                      className={buttonClassName('secondary')}
                      disabled={groups.length === 0}
                      onClick={() => download('drawings.csv', registerCsv(groups, setFor))}
                    >
                      <Download size={20} strokeWidth={1.5} aria-hidden="true" />
                      Export
                    </button>
                  ) : null}
                </>
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
            <ErrorAlert
              error={sheets.error ?? all.error}
              title="We couldn't load the drawing register"
            />
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
            ) : groups.length === 0 ? (
              <EmptyState
                icon={DrawingsIcon}
                title="No drawings match"
                description="Clear the filters, or upload the first drawing set for this project."
              />
            ) : (
              <>
                <div className="drw-summary">
                  <p className="u-muted" role="status">
                    Displaying {(sheets.data ?? []).length} drawings in {groups.length}{' '}
                    {groups.length === 1 ? 'discipline' : 'disciplines'}
                  </p>
                  <button
                    type="button"
                    className={buttonClassName('secondary')}
                    onClick={() =>
                      setCollapsed(
                        collapsed.size === 0 ? new Set(groups.map((g) => g.key)) : new Set(),
                      )
                    }
                  >
                    {collapsed.size === 0 ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>
                {groups.map((g) => {
                  const open = !collapsed.has(g.key);
                  const panelId = `drw-group-${g.key || 'none'}`;
                  return (
                    <section key={g.key} className="drw-group">
                      <h2 className="drw-group__title">
                        <button
                          type="button"
                          className="drw-group__toggle ac-focusable"
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (open) next.add(g.key);
                              else next.delete(g.key);
                              return next;
                            })
                          }
                        >
                          <ChevronDown
                            size={20}
                            strokeWidth={1.5}
                            aria-hidden="true"
                            className={open ? undefined : 'drw-group__chevron--closed'}
                          />
                          {g.label}
                          <span className="u-muted"> ({g.sheets.length})</span>
                        </button>
                      </h2>
                      <div id={panelId} hidden={!open}>
                        <DataTable
                          caption={`${g.label} drawings`}
                          columns={columns}
                          rows={g.sheets}
                          getRowId={(x) => x.id}
                          defaultSort={{ columnId: 'number', direction: 'asc' }}
                        />
                      </div>
                    </section>
                  );
                })}
              </>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}
