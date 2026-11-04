'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Dialog,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Estimate, EstimateLine } from '../data/estimates-api';
import { useCostItems, useEstimate, useEstimateMutations } from '../hooks/useEstimates';
import { dollars, parsePercent, parseQuantity, parseRate } from '../lib/estimate-format';

/** A field that saves when you leave it, and puts the old value back when what you typed is not a number. */
function CommitInput({
  label,
  value,
  disabled,
  onCommit,
  parse,
  className = 'ac-input ac-input--narrow ac-table__num',
}: {
  label: string;
  value: string;
  disabled?: boolean;
  /** Returns the cleaned text to save, or undefined when it is not valid. */
  parse: (text: string) => string | null | undefined;
  onCommit: (clean: string | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return (
    <input
      className={className}
      inputMode="decimal"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const clean = parse(text);
        if (clean === undefined || (clean ?? '') === value) setText(value);
        else onCommit(clean);
      }}
    />
  );
}

const TOTAL_ROWS: Array<[keyof Estimate['totals'], string]> = [
  ['subtotal', 'Lines'],
  ['contingency', 'Contingency'],
  ['margin', 'Margin'],
  ['totalExGst', 'Total ex GST'],
  ['gst', 'GST'],
  ['totalIncGst', 'Total inc GST'],
];

/**
 * The estimate sheet (EST-US11): sections and priced lines, then contingency, margin and GST as plain percentages
 * the estimator sets. Quantities that come from takeoff follow what has been accepted; a line without a rate is
 * flagged and left out of the total, and the estimate cannot be issued until every line has one.
 */
export function EstimateScreen({ estimateId }: { estimateId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'estimate', id: estimateId },
  });
  const query = useEstimate(estimateId);
  const m = useEstimateMutations(estimateId);
  const [adding, setAdding] = useState<{
    parentId: string;
    costItemId: string;
    description: string;
    quantity: string;
    unit: string;
    rate: string;
  } | null>(null);
  const [sectionName, setSectionName] = useState<string | null>(null);

  if (previewDataOnly)
    return (
      <div className="stack-lg">
        <PageHeader eyebrow="Estimating" title="Estimate" />
        <PreviewDataNotice tool="Estimates" />
      </div>
    );
  if (query.isPending) return <SkeletonRows label="Loading estimate…" />;
  if (query.error || !query.data)
    return <ErrorAlert error={query.error} title="We couldn't load the estimate" />;

  const e = query.data;
  const locked = e.status === 'issued';
  const sections = e.lines.filter((l) => l.kind === 'section');
  const itemsIn = (parentId: string | null) =>
    e.lines.filter((l) => l.kind === 'item' && l.parentId === parentId);
  const waiting = e.lines.reduce((n, l) => n + l.pendingMeasurements, 0);
  const patchSettings = (patch: Parameters<typeof m.settings.mutate>[0]['patch']) =>
    m.settings.mutate({ estimate: e, patch });
  const mutationError =
    m.settings.error ??
    m.addLine.error ??
    m.updateLine.error ??
    m.deleteLine.error ??
    m.issue.error;

  const itemRow = (line: EstimateLine) => {
    const fromTakeoff = line.measurementIds.length > 0;
    return (
      <tr key={line.id}>
        <th scope="row">
          <CommitInput
            className="ac-input"
            label={`Description of ${line.description}`}
            value={line.description}
            disabled={locked}
            parse={(t) => (t.trim() ? t.trim() : undefined)}
            onCommit={(d) =>
              m.updateLine.mutate({ lineId: line.id, patch: { description: d ?? '' } })
            }
          />
          <div className="u-caption">
            {fromTakeoff ? 'From takeoff' : null}
            {line.pendingMeasurements > 0
              ? ` · ${line.pendingMeasurements} mark${line.pendingMeasurements === 1 ? '' : 's'} waiting for acceptance, not counted`
              : null}
            {line.unitMismatch ? ' · Unit differs from the library item' : null}
          </div>
        </th>
        <td className="ac-table__num">
          {fromTakeoff || locked ? (
            (line.quantity ?? '—')
          ) : (
            <CommitInput
              label={`Quantity of ${line.description}`}
              value={line.quantity ?? ''}
              parse={parseQuantity}
              onCommit={(q) => m.updateLine.mutate({ lineId: line.id, patch: { quantity: q } })}
            />
          )}
        </td>
        <td>{line.unit ?? '—'}</td>
        <td className="ac-table__num">
          {locked ? (
            line.rate ? (
              dollars(line.rate)
            ) : (
              '—'
            )
          ) : (
            <CommitInput
              label={`Rate of ${line.description}`}
              value={line.rate ?? ''}
              parse={parseRate}
              onCommit={(r) => m.updateLine.mutate({ lineId: line.id, patch: { rate: r } })}
            />
          )}
        </td>
        <td className="ac-table__num">
          {line.amount ? (
            dollars(line.amount)
          ) : (
            <StatusPill tone="warning">{line.rate ? 'No quantity' : 'No rate'}</StatusPill>
          )}
        </td>
        <td className="ac-table__num">
          {locked ? null : (
            <Button
              size="sm"
              variant="tertiary"
              aria-label={`Remove ${line.description}`}
              onClick={() => m.deleteLine.mutate(line.id)}
            >
              Remove
            </Button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={`Estimating · ${e.numberLabel}`}
        title={e.name}
        description={
          locked
            ? 'Issued. Quantities, rates and the total are frozen.'
            : 'A draft. Takeoff quantities follow what has been accepted on the drawings.'
        }
        actions={
          <>
            <Link className="link" href={webRoutes.estimates(org.orgSlug, project.projectId)}>
              All estimates
            </Link>
            <StatusPill tone={locked ? 'success' : 'neutral'}>
              {locked ? 'Issued' : 'Draft'}
            </StatusPill>
            {locked ? null : (
              <Button
                loading={m.issue.isPending}
                disabled={e.totals.missingRates > 0 || e.lines.every((l) => l.kind === 'section')}
                onClick={() => m.issue.mutate(e)}
              >
                Issue estimate
              </Button>
            )}
          </>
        }
      />
      {e.totals.missingRates > 0 ? (
        <Alert tone="warning" title="Some lines are not priced">
          {e.totals.missingRates} {e.totals.missingRates === 1 ? 'line has' : 'lines have'} no
          quantity or rate. They add nothing to the total, and the estimate cannot be issued until
          every line is priced.
        </Alert>
      ) : null}
      {waiting > 0 ? (
        <Alert tone="info" title="Takeoff waiting for acceptance">
          {waiting} {waiting === 1 ? 'mark is' : 'marks are'} still waiting for a person to accept
          them in the drawing viewer. Only accepted quantities are priced.
        </Alert>
      ) : null}
      <ErrorAlert error={mutationError} title="We couldn't save that change" />

      <section aria-labelledby="est-settings" className="stack">
        <h2 id="est-settings" className="panel-subheading">
          Rates, contingency, margin and GST
        </h2>
        <div className="form-row">
          <TextField
            label="Rates as at"
            type="date"
            disabled={locked}
            value={e.baseDate}
            onChange={(ev) => ev.target.value && patchSettings({ baseDate: ev.target.value })}
          />
          <TextField
            label="Region"
            hint="Picks regional library rates first."
            disabled={locked}
            defaultValue={e.region ?? ''}
            key={`region-${e.version}`}
            onBlur={(ev) =>
              (ev.target.value.trim() || null) !== e.region &&
              patchSettings({ region: ev.target.value.trim() || null })
            }
          />
        </div>
        <div className="form-row">
          {(
            [
              ['contingencyPct', 'Contingency %'],
              ['marginPct', 'Margin %'],
              ['gstPct', 'GST %'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="stack">
              <span>{label}</span>
              <CommitInput
                className="ac-input"
                label={label}
                value={e[key]}
                disabled={locked}
                parse={(t) => parsePercent(t)}
                onCommit={(v) => v !== null && patchSettings({ [key]: v })}
              />
            </label>
          ))}
          <Select
            label="Margin is"
            disabled={locked}
            value={e.marginBasis}
            options={[
              { value: 'markup', label: 'Markup on cost' },
              { value: 'margin', label: 'Share of selling price' },
            ]}
            onChange={(ev) =>
              patchSettings({ marginBasis: ev.target.value as Estimate['marginBasis'] })
            }
          />
        </div>
      </section>

      <section aria-labelledby="est-lines" className="stack">
        <div className="row-actions takeoff-quantities__head">
          <h2 id="est-lines" className="panel-subheading">
            Lines
          </h2>
          {locked ? null : (
            <div className="row-actions">
              <Button size="sm" variant="secondary" onClick={() => setSectionName('')}>
                Add section
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  setAdding({
                    parentId: '',
                    costItemId: '',
                    description: '',
                    quantity: '',
                    unit: '',
                    rate: '',
                  })
                }
              >
                <Plus size={16} aria-hidden="true" /> Add line
              </Button>
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table className="ac-table ac-table--compact estimate-lines">
            <caption className="ac-visually-hidden">Estimate lines</caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className="ac-table__num">
                  Quantity
                </th>
                <th scope="col">Unit</th>
                <th scope="col" className="ac-table__num">
                  Rate ex GST
                </th>
                <th scope="col" className="ac-table__num">
                  Amount ex GST
                </th>
                <th scope="col" className="ac-table__num">
                  <span className="ac-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {e.lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="u-muted">
                    No lines yet. Add a line, or send accepted takeoff from the drawing viewer.
                  </td>
                </tr>
              ) : null}
              {itemsIn(null).map(itemRow)}
              {sections.flatMap((s) => [
                <tr key={s.id} className="ac-table__group">
                  <th scope="rowgroup" colSpan={4}>
                    {s.description}
                  </th>
                  <td className="ac-table__num">{dollars(e.totals.sections[s.id] ?? '0.00')}</td>
                  <td className="ac-table__num">
                    {locked ? null : (
                      <Button
                        size="sm"
                        variant="tertiary"
                        aria-label={`Remove section ${s.description}`}
                        onClick={() => m.deleteLine.mutate(s.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>,
                ...itemsIn(s.id).map(itemRow),
              ])}
            </tbody>
          </table>
        </div>
      </section>

      <table className="ac-table ac-table--compact estimate-totals">
        <caption className="ac-visually-hidden">Estimate totals</caption>
        <tbody>
          {TOTAL_ROWS.map(([key, label]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td className="ac-table__num">{dollars(e.totals[key] as string)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog
        open={sectionName !== null}
        onClose={() => setSectionName(null)}
        title="New section"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSectionName(null)}>
              Cancel
            </Button>
            <Button
              disabled={!sectionName?.trim()}
              onClick={() =>
                m.addLine.mutate(
                  { kind: 'section', description: sectionName ?? '' },
                  { onSuccess: () => setSectionName(null) },
                )
              }
            >
              Add section
            </Button>
          </>
        }
      >
        <TextField
          label="Name"
          value={sectionName ?? ''}
          onChange={(ev) => setSectionName(ev.target.value)}
        />
      </Dialog>

      {adding ? (
        <AddLineDialog
          sections={sections}
          value={adding}
          onChange={setAdding}
          pending={m.addLine.isPending}
          onClose={() => setAdding(null)}
          onAdd={(input) => m.addLine.mutate(input, { onSuccess: () => setAdding(null) })}
        />
      ) : null}
    </div>
  );
}

type AddState = {
  parentId: string;
  costItemId: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
};

function AddLineDialog({
  sections,
  value,
  onChange,
  pending,
  onClose,
  onAdd,
}: {
  sections: EstimateLine[];
  value: AddState;
  onChange: (v: AddState) => void;
  pending: boolean;
  onClose: () => void;
  onAdd: (
    input: Parameters<ReturnType<typeof useEstimateMutations>['addLine']['mutate']>[0],
  ) => void;
}) {
  const library = useCostItems();
  const quantity = parseQuantity(value.quantity);
  const rate = parseRate(value.rate);
  const chosen = library.data?.find((i) => i.id === value.costItemId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add line"
      description="Pick a library item to bring its current rate, or type your own."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={
              (!value.description.trim() && !chosen) || quantity === undefined || rate === undefined
            }
            onClick={() =>
              onAdd({
                ...(value.parentId ? { parentId: value.parentId } : {}),
                ...(value.costItemId ? { costItemId: value.costItemId } : {}),
                ...(value.description.trim() ? { description: value.description.trim() } : {}),
                ...(quantity ? { quantity } : {}),
                ...(value.unit.trim() ? { unit: value.unit.trim() } : {}),
                ...(rate ? { rate } : {}),
              })
            }
          >
            Add line
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Library item"
          placeholder="None, type my own"
          value={value.costItemId}
          options={(library.data ?? []).map((i) => ({
            value: i.id,
            label: `${i.code}: ${i.description}`,
          }))}
          onChange={(ev) => onChange({ ...value, costItemId: ev.target.value })}
        />
        {chosen && !chosen.currentRate && !value.rate ? (
          <Alert tone="warning" title="No rate for this item yet">
            The line will be added unpriced. Give it a rate here, or add one in the cost library.
          </Alert>
        ) : null}
        <TextField
          label="Description"
          hint={chosen ? 'Leave blank to use the library description.' : undefined}
          value={value.description}
          onChange={(ev) => onChange({ ...value, description: ev.target.value })}
        />
        <div className="form-row">
          <TextField
            label="Quantity"
            inputMode="decimal"
            value={value.quantity}
            error={quantity === undefined ? 'Enter a number' : undefined}
            onChange={(ev) => onChange({ ...value, quantity: ev.target.value })}
          />
          <TextField
            label="Unit"
            hint={chosen ? `Library unit: ${chosen.unit}` : undefined}
            value={value.unit}
            onChange={(ev) => onChange({ ...value, unit: ev.target.value })}
          />
          <TextField
            label="Rate ex GST"
            hint={chosen?.currentRate ? `Library: ${dollars(chosen.currentRate.rate)}` : undefined}
            inputMode="decimal"
            value={value.rate}
            error={rate === undefined ? 'Enter dollars' : undefined}
            onChange={(ev) => onChange({ ...value, rate: ev.target.value })}
          />
        </div>
        {sections.length > 0 ? (
          <Select
            label="Section"
            placeholder="No section"
            value={value.parentId}
            options={sections.map((s) => ({ value: s.id, label: s.description }))}
            onChange={(ev) => onChange({ ...value, parentId: ev.target.value })}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
