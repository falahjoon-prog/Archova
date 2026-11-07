'use client';

import Link from 'next/link';
import { useState } from 'react';
import { daysBetween } from '@archova/time';
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { DefectsIcon, Download, Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { todayIn } from '@/shared/lib/format';
import { MOCK_LEVELS, locationPath } from '@/shared/mocks/locations';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useSheetPicker } from '@/features/drawings';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { DefectDue, DefectStatusPill, StageBadge } from '../components/DefectChips';
import { useDefectList, useDefectMutations, useDefectsSource } from '../hooks/useDefects';
import { defectsToCsv } from '../lib/csv';
import {
  DEFECT_STATUSES,
  STAGE_LABELS,
  STATUS_LABELS,
  formatDefectNumber,
  type Defect,
  type DefectStage,
  type DefectStatus,
} from '../lib/types';

/** Defects register (DEF-US8): by trade, level, status, stage and age; bulk assign; CSV for a walk. */
export function DefectListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const { live } = useDefectsSource();
  const dir = useProjectDirectory();
  const sheets = useSheetPicker(project.projectId);
  // The API stores the pinned revision only; its sheet comes from the register (a superseded revision isn't listed).
  const pinLabel = (d: { drawing: { revisionId: string; label: string } | null }) =>
    d.drawing
      ? (sheets.options.find((o) => o.revisionId === d.drawing!.revisionId)?.label ??
        'On a drawing')
      : null;
  const subbies = dir.companies.filter((c) => c.isSubcontractor && dir.onProject(c.id));
  const trades = [...new Set(subbies.flatMap((c) => c.trades))];
  // A subcontractor can't list the org's companies, so their own company is named from the project context.
  const assignee = (id: string | null) =>
    id ? (id === project.companyId ? 'Your company' : dir.companyName(id)) : 'Unassigned';
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'defects', id: 'register' },
  });
  const today = todayIn(project.timezone);
  const [params, setParams] = useUrlState([
    'status',
    'stage',
    'company',
    'trade',
    'level',
    'overdue',
    'q',
  ] as const);
  const status = (DEFECT_STATUSES as readonly string[]).includes(params.status)
    ? (params.status as DefectStatus)
    : undefined;
  const stage = params.stage in STAGE_LABELS ? (params.stage as DefectStage) : undefined;
  const list = useDefectList({
    status,
    stage,
    companyId: params.company || undefined,
    trade: params.trade || undefined,
    level: params.level || undefined,
    overdueOn: params.overdue ? today : undefined,
    q: params.q || undefined,
  });
  const all = useDefectList({});
  const m = useDefectMutations();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ companyId: '', dueDate: '', stage: '' });
  const rows = list.data ?? [];
  const filtered = Object.values(params).some(Boolean);
  const reviewCount = (all.data ?? []).filter((d) => d.status === 'ready_for_review').length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns: DataTableColumn<Defect>[] = [
    {
      id: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="Select all shown"
          checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
          onChange={(e) =>
            setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
          }
        />
      ),
      cell: (d) => (
        <input
          type="checkbox"
          aria-label={`Select ${formatDefectNumber(d.number)}`}
          checked={selected.has(d.id)}
          onChange={(e) => toggle(d.id, e.target.checked)}
        />
      ),
    },
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (d) => d.number ?? 0,
      cell: (d) => (
        <Link className="link u-mono" href={webRoutes.defect(org.orgSlug, project.projectId, d.id)}>
          {formatDefectNumber(d.number)}
        </Link>
      ),
    },
    { id: 'title', header: 'Title', sortValue: (d) => d.title, cell: (d) => d.title },
    {
      id: 'location',
      header: 'Location',
      sortValue: (d) =>
        d.locationPath ??
        locationPath(d.locationId) ??
        (live ? pinLabel(d) : d.drawing?.label) ??
        '',
      cell: (d) =>
        d.locationPath ??
        locationPath(d.locationId) ??
        (live ? pinLabel(d) : d.drawing?.label) ??
        '—',
    },
    {
      id: 'company',
      header: 'Company',
      sortValue: (d) => assignee(d.assigneeCompanyId),
      cell: (d) => (
        <>
          {assignee(d.assigneeCompanyId)}
          <br />
          <span className="u-caption">{d.trade}</span>
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (d) => DEFECT_STATUSES.indexOf(d.status),
      cell: (d) => <DefectStatusPill status={d.status} />,
    },
    {
      id: 'stage',
      header: 'Stage',
      sortValue: (d) => d.stage,
      cell: (d) => <StageBadge stage={d.stage} />,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (d) => d.dueDate ?? '9999',
      cell: (d) => <DefectDue defect={d} today={today} />,
    },
    {
      id: 'age',
      header: 'Age',
      align: 'end',
      sortValue: (d) => d.createdAt,
      cell: (d) => `${daysBetween(d.createdAt.slice(0, 10), today)} d`,
    },
  ];

  const exportCsv = () => {
    const blob = new Blob([defectsToCsv(rows, assignee)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `defects-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyBulk = () =>
    m.bulkAssign.mutate(
      {
        ids: [...selected],
        ...(bulk.companyId ? { companyId: bulk.companyId } : {}),
        ...(bulk.dueDate ? { dueDate: bulk.dueDate } : {}),
        ...(bulk.stage ? { stage: bulk.stage as DefectStage } : {}),
      },
      {
        onSuccess: () => {
          setSelected(new Set());
          setBulk({ companyId: '', dueDate: '', stage: '' });
        },
      },
    );

  return (
    <div className="stack-lg">
      <PageHeader
        title="Defects"
        description="Raise, assign and close out defects by location, trade and stage."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>
              <Download size={16} aria-hidden="true" /> Export CSV
            </Button>
            <Link
              className={buttonClassName('primary')}
              href={webRoutes.newDefect(org.orgSlug, project.projectId)}
            >
              <Plus size={16} aria-hidden="true" /> New defect
            </Link>
          </>
        }
      />
      {live ? null : <PreviewDataNotice tool="Defects" />}
      {reviewCount > 0 && params.status !== 'ready_for_review' ? (
        <p className="u-m-0">
          <button
            type="button"
            className="link-button"
            onClick={() => setParams({ status: 'ready_for_review' })}
          >
            {reviewCount} {reviewCount === 1 ? 'defect is' : 'defects are'} ready for inspection
          </button>
        </p>
      ) : null}
      <FilterBar label="Filter defects">
        <TextField
          label="Search"
          type="search"
          value={params.q}
          placeholder="Number or words"
          onChange={(e) => setParams({ q: e.target.value })}
        />
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={DEFECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Stage"
          value={params.stage}
          placeholder="Any stage"
          options={(Object.keys(STAGE_LABELS) as DefectStage[]).map((s) => ({
            value: s,
            label: STAGE_LABELS[s],
          }))}
          onChange={(e) => setParams({ stage: e.target.value })}
        />
        <Select
          label="Company"
          value={params.company}
          placeholder="Any company"
          options={subbies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setParams({ company: e.target.value })}
        />
        <Select
          label="Trade"
          value={params.trade}
          placeholder="Any trade"
          options={trades.map((t) => ({ value: t, label: t }))}
          onChange={(e) => setParams({ trade: e.target.value })}
        />
        {live ? null : (
          <Select
            label="Level"
            value={params.level}
            placeholder="Any level"
            options={MOCK_LEVELS.map((l) => ({ value: l, label: l }))}
            onChange={(e) => setParams({ level: e.target.value })}
          />
        )}
        <Checkbox
          label="Overdue only"
          checked={Boolean(params.overdue)}
          onChange={(e) => setParams({ overdue: e.target.checked ? '1' : null })}
        />
      </FilterBar>
      {selected.size > 0 ? (
        <section className="bulk-bar" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <Select
            label="Assign to"
            value={bulk.companyId}
            placeholder="Keep company"
            options={subbies.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => setBulk({ ...bulk, companyId: e.target.value })}
          />
          <TextField
            label="Due date"
            type="date"
            value={bulk.dueDate}
            onChange={(e) => setBulk({ ...bulk, dueDate: e.target.value })}
          />
          <Select
            label="Stage"
            value={bulk.stage}
            placeholder="Keep stage"
            options={(Object.keys(STAGE_LABELS) as DefectStage[]).map((s) => ({
              value: s,
              label: STAGE_LABELS[s],
            }))}
            onChange={(e) => setBulk({ ...bulk, stage: e.target.value })}
          />
          <Button
            onClick={applyBulk}
            disabled={m.bulkAssign.isPending || !(bulk.companyId || bulk.dueDate || bulk.stage)}
          >
            Apply to {selected.size}
          </Button>
          <Button variant="tertiary" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </section>
      ) : null}
      <ErrorAlert
        error={list.error ?? m.bulkAssign.error}
        title="Something went wrong with defects"
      />
      {list.isPending ? (
        <SkeletonRows label="Loading defects…" />
      ) : (
        <DataTable
          caption="Defects"
          columns={columns}
          rows={rows}
          getRowId={(d) => d.id}
          defaultSort={{ columnId: 'number', direction: 'desc' }}
          rowClassName={(d) => (d.status === 'void' ? 'row--muted' : undefined)}
          empty={
            <EmptyState
              icon={DefectsIcon}
              title={filtered ? 'No defects match these filters' : 'No defects yet'}
              description={
                filtered
                  ? 'Clear a filter to see more.'
                  : 'Defects raised on site or here will show up in this list.'
              }
            />
          }
        />
      )}
    </div>
  );
}
