'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Switch,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { DocumentsIcon, Download, Save, Trash2 } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import {
  useDeleteReport,
  useProjectChoices,
  useReportPreview,
  useReports,
  useSaveReport,
} from '../hooks/useReporting';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  EMPTY_CONFIG,
  SOURCE_LABELS,
  STATE_LABELS,
  cellValue,
  orderColumns,
  statusLabel,
  toCsv,
  type ReportColumn,
  type ReportConfig,
  type ReportRow,
  type ReportSource,
  type ReportState,
} from '../lib/types';

const NEW = '';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const fileName = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'report'
  }.csv`;

function cell(row: ReportRow, column: ReportColumn) {
  if (column === 'overdue')
    return row.overdue ? (
      <StatusPill tone="danger">Overdue</StatusPill>
    ) : (
      <span className="u-muted">—</span>
    );
  if (column === 'status') return statusLabel(row.status);
  if (column === 'dueDate') return row.dueDate ? formatLocalDate(row.dueDate) : '—';
  if (column === 'createdAt') return formatLocalDate(row.createdAt.slice(0, 10));
  return cellValue(row, column);
}

/** Pick RFIs, defects or submittals across projects, choose the columns, see the rows, save it, download it. */
export function ReportsScreen() {
  const reports = useReports();
  const projects = useProjectChoices();
  const save = useSaveReport();
  const remove = useDeleteReport();

  const [selected, setSelected] = useState<string>(NEW);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [config, setConfig] = useState<ReportConfig>(EMPTY_CONFIG);
  const [saved, setSaved] = useState<string | null>(null);

  const preview = useReportPreview(config);
  const list = useMemo(() => reports.data ?? [], [reports.data]);
  const current = list.find((r) => r.id === selected) ?? null;
  const patch = (p: Partial<ReportConfig>) => {
    setSaved(null);
    setConfig((c) => ({ ...c, ...p }));
  };

  function open(id: string) {
    setSelected(id);
    setSaved(null);
    const r = list.find((x) => x.id === id);
    if (r) {
      setName(r.name);
      setShared(r.shared);
      setConfig(r.config);
    } else {
      setName('');
      setShared(false);
      setConfig(EMPTY_CONFIG);
    }
  }

  function toggleColumn(c: ReportColumn, on: boolean) {
    const next = on ? orderColumns([...config.columns, c]) : config.columns.filter((x) => x !== c);
    // At least one column stays on, or there is nothing to read.
    if (next.length) patch({ columns: next });
  }

  function toggleProject(id: string, on: boolean) {
    patch({
      projectIds: on ? [...config.projectIds, id] : config.projectIds.filter((p) => p !== id),
    });
  }

  async function onSave() {
    const out = await save.mutateAsync({
      id: current?.id ?? null,
      input: { name: name.trim(), shared, config },
    });
    setSelected(out.id);
    setSaved(`Saved “${out.name}”.`);
  }

  async function onDelete() {
    if (!current) return;
    await remove.mutateAsync(current.id);
    open(NEW);
  }

  const result = preview.data;
  const columns: DataTableColumn<ReportRow>[] = (result?.columns ?? config.columns).map((c) => ({
    id: c,
    header: COLUMN_LABELS[c],
    rowHeader: c === 'ref',
    sortValue: (r) => (c === 'overdue' ? Number(r.overdue) : cellValue(r, c)),
    cell: (r) => cell(r, c),
  }));
  const canChange = !current || current.mine;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="Reports"
        description="Build a report across your projects from RFIs, defects or submittals. Rows only include what you are allowed to open on each project."
      />
      <ErrorAlert error={reports.error} title="We couldn't load your saved reports" />
      <Card title="Report setup">
        <div className="stack">
          <div className="form-row">
            <Select
              label="Saved report"
              value={selected}
              placeholder="New report"
              options={list.map((r) => ({
                value: r.id,
                label: r.shared ? `${r.name} (shared)` : r.name,
              }))}
              onChange={(e) => open(e.target.value)}
            />
            <Select
              label="Report on"
              value={config.source}
              options={(Object.keys(SOURCE_LABELS) as ReportSource[]).map((s) => ({
                value: s,
                label: SOURCE_LABELS[s],
              }))}
              onChange={(e) => patch({ source: e.target.value as ReportSource })}
            />
            <Select
              label="Include"
              value={config.state}
              options={(Object.keys(STATE_LABELS) as ReportState[]).map((s) => ({
                value: s,
                label: STATE_LABELS[s],
              }))}
              onChange={(e) => patch({ state: e.target.value as ReportState })}
            />
          </div>
          <Checkbox
            label="Overdue items only"
            checked={config.overdueOnly}
            onChange={(e) => patch({ overdueOnly: e.target.checked })}
          />
        </div>
      </Card>
      <div className="detail-grid">
        <Card title="Projects">
          <p className="u-caption u-m-0">None ticked means all of them.</p>
          <div className="check-grid">
            {(projects.data ?? []).map((p) => (
              <Checkbox
                key={p.id}
                label={p.name}
                checked={config.projectIds.includes(p.id)}
                onChange={(e) => toggleProject(p.id, e.target.checked)}
              />
            ))}
          </div>
        </Card>
        <Card title="Columns">
          <div className="check-grid">
            {COLUMN_ORDER.map((c) => (
              <Checkbox
                key={c}
                label={COLUMN_LABELS[c]}
                checked={config.columns.includes(c)}
                onChange={(e) => toggleColumn(c, e.target.checked)}
              />
            ))}
          </div>
        </Card>
      </div>
      <Card title="Save and export">
        <div className="stack">
          <div className="form-row">
            <TextField
              label="Name"
              value={name}
              maxLength={120}
              onChange={(e) => {
                setSaved(null);
                setName(e.target.value);
              }}
            />
            <Switch
              label="Share with everyone in the company"
              checked={shared}
              onCheckedChange={(v) => {
                setSaved(null);
                setShared(v);
              }}
            />
          </div>
          <div className="row-actions">
            <Button
              onClick={() => void onSave()}
              loading={save.isPending}
              disabled={!name.trim() || !canChange}
            >
              <Save size={16} aria-hidden="true" /> {current ? 'Save changes' : 'Save report'}
            </Button>
            {current && current.mine ? (
              <Button variant="danger" onClick={() => void onDelete()} loading={remove.isPending}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={!result || result.rows.length === 0}
              onClick={() => result && download(fileName(name), toCsv(result))}
            >
              <Download size={16} aria-hidden="true" /> Download CSV
            </Button>
          </div>
          <ErrorAlert error={save.error ?? remove.error} title="We couldn't save that" />
          {saved ? (
            <p className="u-muted" role="status">
              {saved}
            </p>
          ) : null}
        </div>
      </Card>
      {result?.truncated ? (
        <Alert tone="info" title="Showing part of the report">
          This report is longer than we show at once. Narrow it to some projects or to overdue
          items.
        </Alert>
      ) : null}
      {result && result.restrictedProjects > 0 ? (
        <p className="u-muted">
          {result.restrictedProjects}{' '}
          {result.restrictedProjects === 1 ? 'project is' : 'projects are'} left out because you
          can’t open {SOURCE_LABELS[config.source]} there.
        </p>
      ) : null}
      <ErrorAlert error={preview.error} title="We couldn't run the report" />
      {preview.isPending ? (
        <SkeletonRows label="Running the report…" />
      ) : (
        <DataTable
          caption={`${SOURCE_LABELS[config.source]} report`}
          columns={columns}
          rows={result?.rows ?? []}
          getRowId={(r) => `${r.projectId}:${r.ref}`}
          empty={
            <EmptyState
              icon={DocumentsIcon}
              title="Nothing matches"
              description="Change what the report covers to see rows here."
            />
          }
        />
      )}
    </div>
  );
}
