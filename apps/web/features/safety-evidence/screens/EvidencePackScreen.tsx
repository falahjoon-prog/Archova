'use client';

import { useState } from 'react';
import { addDays } from '@archova/time';
import {
  Alert,
  Button,
  Card,
  DataTable,
  FilterBar,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { Download } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { EvidenceGap, SafetyEvidencePack } from '../data/api';
import { rangeIsValid, useEvidencePack, useEvidencePdf } from '../hooks/useEvidencePack';

const SECTIONS = [
  ['incidents', 'Incidents'],
  ['actions', 'Corrective actions'],
  ['pretasks', 'Pre-task plans'],
  ['toolbox', 'Toolbox talks'],
  ['inductions', 'Site inductions'],
  ['inspections', 'Inspections'],
] as const;

type SectionRow = { key: (typeof SECTIONS)[number][0]; label: string; pack: SafetyEvidencePack };

const TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

/** Hands a generated file to the browser as a download. */
function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The safety records of this project for a date range, formatted to hand to a WHS regulator, with Nova's pre-check for
 * what is missing or still open. The pack is a copy of what was recorded; it never says the site complied.
 */
export function EvidencePackScreen() {
  const project = useCurrentProject();
  const today = todayIn(project.timezone);
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const pack = useEvidencePack(range);
  const pdf = useEvidencePdf();
  const data = pack.data;
  const valid = rangeIsValid(range);

  const rows: SectionRow[] = SECTIONS.map(([key, label]) => ({ key, label, pack: data! }));
  const columns: DataTableColumn<SectionRow>[] = [
    { id: 'section', header: 'Section', rowHeader: true, cell: (r) => r.label },
    {
      id: 'records',
      header: 'Records',
      align: 'end',
      cell: (r) => (r.pack[r.key].restricted ? '—' : r.pack[r.key].rows.length),
    },
    {
      id: 'status',
      header: 'Included',
      cell: (r) =>
        r.pack[r.key].restricted ? (
          <StatusPill tone="warning">No access</StatusPill>
        ) : r.pack[r.key].truncated ? (
          <StatusPill tone="warning">Cut off at the row limit</StatusPill>
        ) : (
          <StatusPill tone="success">Included</StatusPill>
        ),
    },
  ];
  const gapColumns: DataTableColumn<EvidenceGap>[] = [
    {
      id: 'severity',
      header: 'Severity',
      cell: (g) => <StatusPill tone={TONE[g.severity]}>{g.severity}</StatusPill>,
    },
    { id: 'message', header: 'What Nova found', cell: (g) => g.message },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Quality & safety"
        title="Safety evidence pack"
        description="Inductions, pre-task plans, inspections, incidents, corrective actions and toolbox talks for a date range, ready to hand to a WHS regulator during an audit or after an incident."
        actions={
          <Button
            onClick={() => void pdf.mutateAsync(range).then(saveFile)}
            loading={pdf.isPending}
            disabled={!data || !valid}
          >
            <Download size={16} aria-hidden="true" /> Download PDF
          </Button>
        }
      />
      <FilterBar label="Date range">
        <TextField
          label="From"
          type="date"
          max={range.to}
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
        />
        <TextField
          label="To"
          type="date"
          min={range.from}
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
        />
      </FilterBar>
      {!valid ? (
        <Alert tone="warning" title="Check the dates">
          Choose a start date on or before the end date.
        </Alert>
      ) : null}
      <ErrorAlert error={pack.error ?? pdf.error} title="We couldn't build the pack" />
      {pack.isLoading ? <SkeletonRows label="Building the pack…" /> : null}
      {data ? (
        <>
          <Card title="Checked before export">
            {data.gaps.length === 0 ? (
              <Alert tone="success" title="Nothing stands out">
                Nova found no gaps in the records you can see for these dates.
              </Alert>
            ) : (
              <DataTable
                caption="Gaps found before export"
                columns={gapColumns}
                rows={data.gaps}
                getRowId={(g) => `${g.section}:${g.message}`}
              />
            )}
            <p className="u-muted">
              Nova checks the records against simple rules. It shows what is missing or still open
              and does not say the site complied. Archova does not notify the regulator: dates shown
              are the ones your team entered.
            </p>
          </Card>
          <Card title="What the pack contains">
            <DataTable
              caption="Pack contents"
              columns={columns}
              rows={rows}
              getRowId={(r) => r.key}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
