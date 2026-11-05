'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  DescriptionList,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ImportsIcon, Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type {
  ImportEntity,
  ImportJob,
  ImportRow,
  ImportRowStatus,
  ImportSource,
  MappingSuggestion,
} from '../data/api';
import {
  useImportJob,
  useImportJobs,
  useImportMutations,
  useImportRows,
} from '../hooks/useImports';

const ENTITY_LABEL: Record<ImportEntity, string> = {
  rfi: 'RFIs',
  defect: 'Defects',
  drawing_register: 'Drawing register',
  company: 'Companies',
};
const SOURCE_LABEL: Record<ImportSource, string> = {
  spreadsheet: 'Spreadsheet',
  aconex_export: 'Aconex export',
  procore_export: 'Procore export',
};
const STATUS_LABEL: Record<ImportJob['status'], string> = {
  uploaded: 'Uploaded',
  parsed: 'Read, needs mapping',
  mapped: 'Mapped',
  validated: 'Checked',
  applying: 'Applying',
  done: 'Done',
  failed: 'Failed',
  rolled_back: 'Rolled back',
  cancelled: 'Cancelled',
};
const STATUS_TONE: Record<ImportJob['status'], StatusTone> = {
  uploaded: 'info',
  parsed: 'warning',
  mapped: 'info',
  validated: 'success',
  applying: 'info',
  done: 'success',
  failed: 'danger',
  rolled_back: 'danger',
  cancelled: 'neutral',
};
const OPEN: ImportJob['status'][] = ['uploaded', 'parsed', 'mapped', 'validated'];
const ROW_STATUS_LABEL: Record<ImportRowStatus, string> = {
  staged: 'Not checked',
  valid: 'Ready',
  invalid: 'Has problems',
  skipped: 'Skipped',
  applied: 'Imported',
  failed: 'Failed',
};

export function ImportsScreen() {
  const [params] = useUrlState(['id'] as const);
  return params.id ? <ImportDetail id={params.id} /> : <ImportList />;
}

function ImportList() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const list = useImportJobs();
  const [adding, setAdding] = useState(false);
  const columns: DataTableColumn<ImportJob>[] = [
    {
      id: 'what',
      header: 'Import',
      rowHeader: true,
      cell: (j) => (
        <Link
          href={webRoutes.imports(org.orgSlug, project.projectId, j.id)}
          aria-label={`${ENTITY_LABEL[j.entity]} import, ${formatInstant(j.createdAt, project.timezone)}`}
        >
          {ENTITY_LABEL[j.entity]}
        </Link>
      ),
    },
    { id: 'source', header: 'From', cell: (j) => SOURCE_LABEL[j.source] },
    {
      id: 'started',
      header: 'Started',
      sortValue: (j) => j.createdAt,
      cell: (j) => formatInstant(j.createdAt, project.timezone),
    },
    {
      id: 'rows',
      header: 'Rows',
      cell: (j) =>
        j.totalRows === 0
          ? '—'
          : `${j.totalRows} · ${j.validRows} ready · ${j.invalidRows} with problems`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (j) => <StatusPill tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</StatusPill>,
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Project admin"
        title="Imports"
        description="Bring a register in from a spreadsheet or another system. You check every row before anything is created."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> New import
          </Button>
        }
      />
      <ErrorAlert error={list.error} title="We couldn't load imports" />
      {list.isPending ? (
        <SkeletonRows label="Loading imports…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={ImportsIcon}
          title="No imports yet"
          description="Export the register as a CSV file, then start an import."
        />
      ) : (
        <DataTable
          caption="Imports"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(j) => j.id}
        />
      )}
      {adding ? <NewImportDialog onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function NewImportDialog({ onClose }: { onClose: () => void }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const m = useImportMutations();
  const router = useRouter();
  const [entity, setEntity] = useState<ImportEntity>('rfi');
  const [source, setSource] = useState<ImportSource>('spreadsheet');
  const [headerRow, setHeaderRow] = useState('1');
  const [file, setFile] = useState<File | null>(null);
  const row = Number(headerRow);
  const rowOk = Number.isInteger(row) && row >= 1 && row <= 100;
  return (
    <Dialog
      open
      onClose={onClose}
      title="New import"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!file || !rowOk || m.start.isPending}
            onClick={() =>
              file &&
              m.start.mutate(
                { file, entity, source, headerRow: row },
                {
                  onSuccess: (job) => {
                    onClose();
                    router.push(webRoutes.imports(org.orgSlug, project.projectId, job.id));
                  },
                },
              )
            }
          >
            {m.start.isPending ? 'Uploading and reading…' : 'Upload and read file'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="What are you importing?"
          value={entity}
          options={(Object.keys(ENTITY_LABEL) as ImportEntity[]).map((v) => ({
            value: v,
            label: ENTITY_LABEL[v],
          }))}
          onChange={(e) => setEntity(e.target.value as ImportEntity)}
        />
        <Select
          label="Where is it from?"
          value={source}
          options={(Object.keys(SOURCE_LABEL) as ImportSource[]).map((v) => ({
            value: v,
            label: SOURCE_LABEL[v],
          }))}
          onChange={(e) => setSource(e.target.value as ImportSource)}
        />
        <div className="ac-field">
          <label className="ac-field__label" htmlFor="imp-file">
            CSV file
          </label>
          <input
            id="imp-file"
            className="file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="ac-field__hint">
            Export the register as CSV. The file is checked for viruses first.
          </p>
        </div>
        <TextField
          label="Row the headings are on"
          inputMode="numeric"
          value={headerRow}
          onChange={(e) => setHeaderRow(e.target.value)}
          error={rowOk ? undefined : 'Enter a row from 1 to 100'}
        />
        <ErrorAlert error={m.start.error} title="We couldn't start this import" />
      </div>
    </Dialog>
  );
}

function ImportDetail({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const job = useImportJob(id);
  const m = useImportMutations();
  const j = job.data;
  const open = j ? OPEN.includes(j.status) : false;
  return (
    <>
      <PageHeader
        eyebrow={<Link href={webRoutes.imports(org.orgSlug, project.projectId)}>All imports</Link>}
        title={j ? `${ENTITY_LABEL[j.entity]} import` : 'Import'}
        description={
          j
            ? `From ${SOURCE_LABEL[j.source].toLowerCase()}, started ${formatInstant(j.createdAt, project.timezone)}.`
            : undefined
        }
        actions={
          j && open ? (
            <Button
              variant="secondary"
              disabled={m.cancel.isPending}
              onClick={() => m.cancel.mutate(j)}
            >
              Cancel import
            </Button>
          ) : null
        }
      />
      <ErrorAlert error={job.error} title="We couldn't load this import" />
      <ErrorAlert error={m.cancel.error} title="We couldn't cancel this import" />
      {!j ? (
        job.isPending ? (
          <SkeletonRows label="Loading import…" />
        ) : null
      ) : (
        <div className="stack">
          <DescriptionList
            items={[
              {
                label: 'Status',
                value: (
                  <StatusPill tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</StatusPill>
                ),
              },
              { label: 'Rows in the file', value: j.totalRows },
              { label: 'Ready', value: j.validRows },
              { label: 'With problems', value: j.invalidRows },
            ]}
          />
          {j.status === 'uploaded' ? (
            <Alert tone="info" title="The file hasn't been read yet">
              <Button disabled={m.parse.isPending} onClick={() => m.parse.mutate(j)}>
                {m.parse.isPending ? 'Reading…' : 'Read the file'}
              </Button>
              <ErrorAlert error={m.parse.error} title="We couldn't read this file" />
            </Alert>
          ) : null}
          {j.status === 'parsed' || j.status === 'mapped' || j.status === 'validated' ? (
            <MappingStep job={j} />
          ) : null}
          {j.status === 'validated' ? (
            <>
              <Alert tone="info" title="Nothing has been created">
                This was a dry run. Applying the rows to the register isn&apos;t available yet.
              </Alert>
              <RowsStep job={j} />
            </>
          ) : null}
          {j.status === 'cancelled' ? (
            <Alert tone="info" title="This import was cancelled">
              Its staged rows are cleared automatically.
            </Alert>
          ) : null}
        </div>
      )}
    </>
  );
}

const NONE = '';

/** Column → field choices, seeded from Nova's suggestion or the saved mapping; the person confirms each one. */
function MappingStep({ job }: { job: ImportJob }) {
  const m = useImportMutations();
  const sample = useImportRows(job.id, undefined, job);
  const [suggestion, setSuggestion] = useState<MappingSuggestion | null>(null);
  const [fieldByColumn, setFieldByColumn] = useState<Record<number, string>>({});
  const [meaning, setMeaning] = useState<Record<string, Record<string, string>>>({});

  // Start from the mapping already saved on the job.
  useEffect(() => {
    const byCol: Record<number, string> = {};
    for (const [field, idx] of Object.entries(job.mapping.columns)) byCol[idx] = field;
    setFieldByColumn(byCol);
    setMeaning(job.mapping.values ?? {});
  }, [job.id, job.version, job.mapping]);

  const fields = suggestion?.fields ?? [];
  const fieldOptions = [
    { value: NONE, label: "Don't import" },
    ...fields.map((f) => ({ value: f.key, label: f.required ? `${f.label} (required)` : f.label })),
  ];
  const mappedFields = new Set(Object.values(fieldByColumn).filter(Boolean));
  const missing = fields.filter((f) => f.required && !mappedFields.has(f.key));

  const suggest = () =>
    m.suggest.mutate(
      { job, rows: sample.data ?? [] },
      {
        onSuccess: (s) => {
          setSuggestion(s);
          const byCol: Record<number, string> = {};
          for (const c of s.columns) if (c.field) byCol[c.index] = c.field;
          setFieldByColumn(byCol);
          const values: Record<string, Record<string, string>> = {};
          for (const v of s.values)
            for (const p of v.pairs) if (p.value) (values[v.field] ??= {})[p.source] = p.value;
          setMeaning(values);
        },
      },
    );

  const save = () => {
    const columns: Record<string, number> = {};
    for (const [idx, field] of Object.entries(fieldByColumn))
      if (field) columns[field] = Number(idx);
    const values: Record<string, Record<string, string>> = {};
    for (const [field, pairs] of Object.entries(meaning))
      if (columns[field] !== undefined && Object.keys(pairs).length > 0) values[field] = pairs;
    m.setMapping.mutate({ job, mapping: { columns, values } });
  };

  return (
    <section aria-labelledby="map-h" className="stack">
      <h2 id="map-h">Match columns to fields</h2>
      {!suggestion ? (
        <Alert
          tone="info"
          title={
            Object.keys(job.mapping.columns).length > 0
              ? `${Object.keys(job.mapping.columns).length} columns are matched. Change them?`
              : 'Let Nova suggest the matches'
          }
        >
          Nova looks at each column&apos;s heading and a few of its values and suggests what it
          fills. You confirm or change every one. It costs a quarter of a Nova credit.
          <div>
            <Button disabled={m.suggest.isPending || sample.isPending} onClick={suggest}>
              {m.suggest.isPending ? 'Asking Nova…' : 'Suggest matches'}
            </Button>
          </div>
          <ErrorAlert error={m.suggest.error} title="Nova couldn't suggest matches" />
        </Alert>
      ) : (
        <>
          <DataTable
            caption="Columns in the file"
            columns={
              [
                {
                  id: 'col',
                  header: 'Column',
                  rowHeader: true,
                  cell: (c) => c.header || `Column ${c.index + 1}`,
                },
                {
                  id: 'ex',
                  header: 'Examples',
                  cell: (c) => c.examples.slice(0, 3).join(' · ') || '—',
                },
                {
                  id: 'field',
                  header: 'Fills',
                  cell: (c) => (
                    <select
                      className="ac-input ac-select"
                      aria-label={`Field for ${c.header || `column ${c.index + 1}`}`}
                      value={fieldByColumn[c.index] ?? NONE}
                      onChange={(e) => {
                        const next = { ...fieldByColumn };
                        // One column per field.
                        if (e.target.value)
                          for (const k of Object.keys(next))
                            if (next[Number(k)] === e.target.value) delete next[Number(k)];
                        if (e.target.value) next[c.index] = e.target.value;
                        else delete next[c.index];
                        setFieldByColumn(next);
                      }}
                    >
                      {fieldOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ),
                },
                {
                  id: 'warn',
                  header: 'Check',
                  cell: (c) =>
                    c.warning === 'unlike_values'
                      ? 'The values don’t look like this field'
                      : c.warning === 'duplicate_field'
                        ? 'Another column fits better'
                        : c.confidence === 'low' && fieldByColumn[c.index]
                          ? 'Low confidence'
                          : '',
                },
              ] satisfies DataTableColumn<MappingSuggestion['columns'][number]>[]
            }
            rows={suggestion.columns}
            getRowId={(c) => String(c.index)}
          />
          {suggestion.values.length > 0 ? (
            <ValueMeanings
              suggestion={suggestion}
              fieldByColumn={fieldByColumn}
              meaning={meaning}
              setMeaning={setMeaning}
            />
          ) : null}
          {missing.length > 0 ? (
            <Alert tone="warning" title="Some required fields have no column">
              {missing.map((f) => f.label).join(', ')}
            </Alert>
          ) : null}
          <div>
            <Button disabled={missing.length > 0 || m.setMapping.isPending} onClick={save}>
              {m.setMapping.isPending ? 'Checking every row…' : 'Save and check rows'}
            </Button>
          </div>
          <ErrorAlert error={m.setMapping.error} title="We couldn't save this mapping" />
        </>
      )}
    </section>
  );
}

function ValueMeanings({
  suggestion,
  fieldByColumn,
  meaning,
  setMeaning,
}: {
  suggestion: MappingSuggestion;
  fieldByColumn: Record<number, string>;
  meaning: Record<string, Record<string, string>>;
  setMeaning: (v: Record<string, Record<string, string>>) => void;
}) {
  const active = suggestion.values.filter((v) => fieldByColumn[v.index] === v.field);
  if (active.length === 0) return null;
  return (
    <section aria-labelledby="vals-h" className="stack">
      <h3 id="vals-h">What the values mean</h3>
      {active.map((v) => {
        const field = suggestion.fields.find((f) => f.key === v.field);
        const options = [
          { value: NONE, label: 'Choose…' },
          ...(field?.values ?? []).map((o) => ({ value: o.value, label: o.label })),
        ];
        return (
          <div key={`${v.index}-${v.field}`} className="stack">
            <p className="u-caption">{field?.label ?? v.field}</p>
            {v.pairs.map((p) => (
              <Select
                key={p.source}
                label={`"${p.source}" in the file means`}
                value={meaning[v.field]?.[p.source] ?? NONE}
                options={options}
                onChange={(e) => {
                  const pairs = { ...(meaning[v.field] ?? {}) };
                  if (e.target.value) pairs[p.source] = e.target.value;
                  else delete pairs[p.source];
                  setMeaning({ ...meaning, [v.field]: pairs });
                }}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function RowsStep({ job }: { job: ImportJob }) {
  const [status, setStatus] = useState<ImportRowStatus>(job.invalidRows > 0 ? 'invalid' : 'valid');
  const rows = useImportRows(job.id, status, job);
  const columns: DataTableColumn<ImportRow>[] = [
    {
      id: 'n',
      header: 'Row',
      rowHeader: true,
      sortValue: (r) => r.rowNumber,
      cell: (r) => r.rowNumber,
    },
    {
      id: 'ref',
      header: 'Their number',
      cell: (r) => r.sourceRef ?? '—',
    },
    {
      id: 'values',
      header: 'Row',
      cell: (r) => r.raw.filter(Boolean).slice(0, 4).join(' · ') || '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <>
          <StatusPill
            tone={r.status === 'invalid' ? 'danger' : r.status === 'valid' ? 'success' : 'neutral'}
          >
            {ROW_STATUS_LABEL[r.status]}
          </StatusPill>
          {r.errors.length > 0 ? (
            <ul className="u-caption">
              {r.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          ) : null}
        </>
      ),
    },
  ];
  return (
    <section aria-labelledby="rows-h" className="stack">
      <h2 id="rows-h">Rows</h2>
      <Select
        label="Show"
        value={status}
        options={(['invalid', 'valid', 'skipped'] as ImportRowStatus[]).map((v) => ({
          value: v,
          label: ROW_STATUS_LABEL[v],
        }))}
        onChange={(e) => setStatus(e.target.value as ImportRowStatus)}
      />
      <ErrorAlert error={rows.error} title="We couldn't load the rows" />
      {rows.isPending ? (
        <SkeletonRows label="Loading rows…" />
      ) : (rows.data ?? []).length === 0 ? (
        <EmptyState icon={ImportsIcon} title="No rows here" description="Try another filter." />
      ) : (
        <DataTable
          caption="Staged rows"
          columns={columns}
          rows={rows.data ?? []}
          getRowId={(r) => r.id}
        />
      )}
      {(rows.data ?? []).length >= 100 ? (
        <p className="u-caption">Showing the first 100 rows.</p>
      ) : null}
    </section>
  );
}
