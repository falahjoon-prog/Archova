'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Tabs,
  Textarea,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatMoney } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentApplicationFinding } from '../data/api';
import { useCommitmentInvoice, useInvoicePdf } from '../hooks/useCommitments';
import { gridRows, type GridRow } from '../lib/applicationGrid';

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

const SECTIONS = [
  ['g702', 'Application and certificates (G702)'],
  ['summary', 'Summary'],
  ['breakdown', 'Schedule of values'],
  ['payment', 'Payment and dates'],
  ['proofread', 'Nova proofread'],
] as const;
const COLUMNS = [
  ['code', 'Item'],
  ['description', 'Description'],
  ['scheduledValue', 'Scheduled value'],
  ['previous', 'Previous'],
  ['thisPeriod', 'This period'],
  ['completedToDate', 'To date'],
  ['percentComplete', '% complete'],
  ['balanceToFinish', 'Balance to finish'],
] as const;
const TONE = { error: 'danger', warning: 'warning', info: 'info' } as const;
const SEVERITY = { error: 'Fix', warning: 'Check', info: 'Note' } as const;

/** One invoice as a payment application: the schedule of values, a summary preview with Nova's proofread, and the PDF. */
export function InvoiceDetailScreen({
  commitmentId,
  claimId,
}: {
  commitmentId: string;
  claimId: string;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const [tab, setTab] = useState('lines');
  const q = useCommitmentInvoice(project.projectId, commitmentId, claimId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'payment_application', id: claimId },
  });

  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (q.error || !q.data)
    return <ErrorAlert error={q.error} title="We couldn't load this payment application" />;
  const a = q.data;
  const open = a.findings.filter((f) => f.severity !== 'info').length;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link
            className="link"
            href={webRoutes.commitment(org.orgSlug, project.projectId, commitmentId)}
          >
            {a.commitmentTitle}
          </Link>
        }
        title={`Payment application ${a.claimNumber}`}
        description={`${a.contractTitle} · ${a.periodStart ?? 'Start'} to ${a.periodEnd}`}
        actions={<StatusPill tone="info">{a.status}</StatusPill>}
      />
      <Tabs
        label="Payment application sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'lines', label: 'Line items', count: a.rows.length },
          { id: 'preview', label: 'Summary preview', count: open || undefined },
        ]}
      >
        {tab === 'lines' ? (
          <LineItems rows={a.rows} />
        ) : (
          <Preview commitmentId={commitmentId} claimId={claimId} app={a} />
        )}
      </Tabs>
    </div>
  );
}

function LineItems({ rows }: { rows: Parameters<typeof gridRows>[0] }) {
  const grid = gridRows(rows);
  const money = (r: GridRow, k: keyof GridRow) => (
    <span className="u-mono u-nowrap">{aud(r[k] as string)}</span>
  );
  const columns: DataTableColumn<GridRow>[] = [
    { id: 'itemNo', header: 'Item no', align: 'end', cell: (r) => r.itemNo },
    {
      id: 'costCode',
      header: 'Cost code',
      cell: (r) => <span className="u-nowrap">{r.costCode}</span>,
    },
    {
      id: 'description',
      header: 'Description of work',
      rowHeader: true,
      cell: (r) => r.description,
    },
    ...(
      [
        ['scheduledValue', 'Scheduled value'],
        ['previous', 'From previous application'],
        ['thisPeriod', 'This period'],
        ['stored', 'Materials presently stored'],
        ['completedAndStored', 'Total completed and stored'],
      ] as const
    ).map(([id, header]) => ({
      id,
      header,
      align: 'end' as const,
      cell: (r: GridRow) => money(r, id),
    })),
    {
      id: 'percent',
      header: '%',
      align: 'end',
      cell: (r) => <span className="u-mono u-nowrap">{r.percent}%</span>,
    },
    { id: 'balance', header: 'Balance to finish', align: 'end', cell: (r) => money(r, 'balance') },
  ];
  return (
    <div className="stack">
      <DataTable
        caption="Schedule of values"
        columns={columns}
        rows={grid.rows}
        getRowId={(r) => r.key}
        footer={
          <tr>
            <th scope="row" colSpan={3} className="u-nowrap">
              Total
            </th>
            {(
              ['scheduledValue', 'previous', 'thisPeriod', 'stored', 'completedAndStored'] as const
            ).map((k) => (
              <td key={k} className="u-end">
                {money(grid.total, k)}
              </td>
            ))}
            <td className="u-end">
              <span className="u-mono u-nowrap">{grid.total.percent}%</span>
            </td>
            <td className="u-end">{money(grid.total, 'balance')}</td>
          </tr>
        }
      />
      <p className="u-muted">
        Total completed, % and balance are worked out from the amounts beside them. Materials
        presently stored is not recorded yet.
      </p>
    </div>
  );
}

function Preview({
  commitmentId,
  claimId,
  app,
}: {
  commitmentId: string;
  claimId: string;
  app: NonNullable<ReturnType<typeof useCommitmentInvoice>['data']>;
}) {
  const project = useCurrentProject();
  const pdf = useInvoicePdf(project.projectId, commitmentId, claimId);
  const [sections, setSections] = useState<string[]>(['g702', 'summary', 'breakdown', 'payment']);
  const [columns, setColumns] = useState<string[]>(COLUMNS.map(([c]) => c));
  const [paper, setPaper] = useState<'a4' | 'letter'>('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [certified, setCertified] = useState('');
  const certifiedValid = /^\d{1,12}(\.\d{1,2})?$/.test(certified);
  const variance = certifiedValid ? Number(certified) - Number(app.summary.currentPaymentDue) : 0;
  const s = app.summary;
  const needsReview = app.findings.some((f) => f.severity !== 'info');
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="stack-lg">
      <section className="stack" aria-labelledby="proofread-h">
        <h2 id="proofread-h">Nova proofread</h2>
        <Findings findings={app.findings} />
        <p className="u-muted">
          Checked against this claim&apos;s own data. Nothing is sent from here; you decide.
        </p>
      </section>
      <section className="stack" aria-labelledby="summary-h">
        <h2 id="summary-h">Summary</h2>
        <StatGrid
          items={[
            { label: 'Revised contract sum', value: aud(s.revisedSum) },
            {
              label: 'Completed to date',
              value: aud(s.completedToDate),
              hint: `${s.percentComplete}% complete`,
            },
            { label: 'Less retainage', value: aud(s.retainage) },
            { label: 'This period', value: aud(s.thisPeriod) },
            { label: 'GST', value: aud(s.gst) },
            { label: 'Current payment due', value: aud(s.currentPaymentDue) },
          ]}
        />
      </section>
      <section className="stack" aria-labelledby="pdf-h">
        <h2 id="pdf-h">PDF layout</h2>
        <fieldset className="stack">
          <legend>Sections</legend>
          {SECTIONS.map(([id, label]) => (
            <Checkbox
              key={id}
              label={label}
              checked={sections.includes(id)}
              onChange={() => toggle(sections, setSections, id)}
            />
          ))}
        </fieldset>
        <fieldset className="stack" disabled={!sections.includes('breakdown')}>
          <legend>Schedule of values columns</legend>
          {COLUMNS.map(([id, label]) => (
            <Checkbox
              key={id}
              label={label}
              checked={columns.includes(id)}
              onChange={() => toggle(columns, setColumns, id)}
            />
          ))}
        </fieldset>
        <Select
          label="Paper"
          options={[
            { value: 'a4', label: 'A4' },
            { value: 'letter', label: 'Letter' },
          ]}
          value={paper}
          onChange={(e) => setPaper(e.target.value as 'a4' | 'letter')}
        />
        <Select
          label="Orientation"
          options={[
            { value: 'landscape', label: 'Landscape' },
            { value: 'portrait', label: 'Portrait' },
          ]}
          value={orientation}
          onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
        />
        <Textarea
          label="Notes on the PDF"
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {sections.includes('g702') ? (
          <>
            <TextField
              label="Amount certified by the architect (AUD)"
              hint="Leave blank to print a blank line on the certificate."
              inputMode="decimal"
              value={certified}
              error={certified && !certifiedValid ? 'Enter an amount like 20900.00' : undefined}
              onChange={(e) => setCertified(e.target.value)}
            />
            {certifiedValid && Math.abs(variance) >= 0.005 ? (
              <Alert tone="warning" title="Certified amount differs">
                Nova: the amount certified is {aud(Math.abs(variance).toFixed(2))}{' '}
                {variance < 0 ? 'less' : 'more'} than the {aud(app.summary.currentPaymentDue)}{' '}
                applied for. Review before sending.
              </Alert>
            ) : null}
          </>
        ) : null}
        <Checkbox
          label="Add a signature block"
          checked={signature}
          onChange={(e) => setSignature(e.target.checked)}
        />
        {needsReview ? (
          <Checkbox
            label="I've read Nova's findings and still want this PDF"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
        ) : null}
        <ErrorAlert error={pdf.error} title="We couldn't make the PDF" />
        <div>
          <Button
            disabled={
              pdf.isPending ||
              sections.length === 0 ||
              (sections.includes('breakdown') && columns.length === 0) ||
              (certified !== '' && !certifiedValid) ||
              (needsReview && !reviewed)
            }
            onClick={() =>
              pdf.mutate(
                {
                  sections,
                  columns,
                  paper,
                  orientation,
                  notes,
                  signatureBlock: signature,
                  ...(certifiedValid ? { amountCertified: certified } : {}),
                },
                { onSuccess: saveFile },
              )
            }
          >
            Download PDF
          </Button>
        </div>
      </section>
    </div>
  );
}

function Findings({ findings }: { findings: PaymentApplicationFinding[] }) {
  if (findings.length === 0)
    return (
      <Alert tone="success" title="Nothing to flag">
        The figures add up to the claim lines, the dates are in order and this period is in line
        with the last.
      </Alert>
    );
  return (
    <ul className="stack" aria-label="Findings">
      {findings.map((f) => (
        <li key={`${f.code}-${f.itemCode ?? ''}-${f.message}`} className="row">
          <StatusPill tone={TONE[f.severity]}>{SEVERITY[f.severity]}</StatusPill>
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}
