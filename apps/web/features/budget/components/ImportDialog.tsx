'use client';

import { useState, type ChangeEvent } from 'react';
import { Alert, Button, Dialog } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { toErrorView } from '@/shared/lib/errors';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useBudgetMutations } from '../hooks/useBudget';
import { parseBudgetCsv, templateCsv, type ImportRow } from '../lib/importCsv';
import { aud } from '../lib/money';

/**
 * Fills the draft budget from a spreadsheet. The template is a CSV, which Excel opens and saves. The whole file is
 * checked by the server and imported all or nothing, with every problem listed by sheet row.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const { importLines } = useBudgetMutations(project.projectId);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    importLines.reset();
    if (!file) return;
    setFileName(file.name);
    const parsed = parseBudgetCsv(await file.text());
    setRows(parsed.rows);
    setProblem(parsed.problem ?? (parsed.rows.length === 0 ? 'The file has no rows.' : null));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'budget-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const fieldErrors = importLines.error ? toErrorView(importLines.error).fieldErrors : {};
  const rowProblems = Object.entries(fieldErrors).flatMap(([path, message]) => {
    const m = /^rows\[(\d+)\]\.(\w+)$/.exec(path);
    // Sheet row: the heading is row 1, so the first data row is row 2.
    return m ? [`Row ${Number(m[1]) + 2}: ${message}`] : [];
  });
  const total = rows.reduce((n, r) => n + (Number(r.original) || 0), 0);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import budget lines"
      description="Download the template, fill it in Excel, save it as CSV and choose it here. Cost codes that don't exist yet are created."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {importLines.isSuccess ? 'Done' : 'Cancel'}
          </Button>
          <Button
            disabled={rows.length === 0 || problem !== null || importLines.isSuccess}
            loading={importLines.isPending}
            onClick={() => importLines.mutate({ rows })}
          >
            Import {rows.length > 0 ? `${rows.length} lines` : ''}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div>
          <Button variant="secondary" onClick={download}>
            Download template
          </Button>
        </div>
        <label className="stack">
          <span>Choose your CSV file</span>
          <input type="file" accept=".csv,text/csv" className="file-input" onChange={pick} />
        </label>
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {rows.length > 0 && !problem ? (
          <p className="u-m-0" aria-live="polite">
            {fileName}: {rows.length} lines, {aud(total.toFixed(2))} in total.
          </p>
        ) : null}
        {rowProblems.length > 0 ? (
          <Alert
            tone="danger"
            title="Nothing was imported. Fix these in your file and choose it again."
          >
            <ul className="plain-list">
              {rowProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <ErrorAlert error={importLines.error} title="We couldn't import the file" />
        )}
        {importLines.isSuccess ? (
          <Alert tone="success">Imported {importLines.data.imported} lines.</Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
