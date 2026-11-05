'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetLine, CostCode } from '../data/api';
import { useBudgetMutations } from '../hooks/useBudget';
import { parseAmount } from '../lib/money';

/** Adds a line to the draft budget, or edits one. A draft line can be changed freely; locking freezes `original`. */
export function LineDialog({
  line,
  availableCodes,
  onClose,
}: {
  /** The line being edited, or null to add one. */
  line: BudgetLine | null;
  availableCodes: CostCode[];
  onClose: () => void;
}) {
  const project = useCurrentProject();
  const { addLine, updateLine } = useBudgetMutations(project.projectId);
  const [costCodeId, setCostCodeId] = useState('');
  const [description, setDescription] = useState(line?.description ?? '');
  const [original, setOriginal] = useState(line?.original ?? '');
  const [isMargin, setIsMargin] = useState(line?.isMargin ?? false);
  const [error, setError] = useState<string | null>(null);
  const pending = addLine.isPending || updateLine.isPending;

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = parseAmount(original);
    if (!line && !costCodeId) return setError('Choose a cost code.');
    if (!amount) return setError('Enter the amount as a dollar amount, like 12500.00.');
    const common = { description: description.trim(), original: amount, isMargin };
    const done = { onSuccess: onClose };
    if (line) updateLine.mutate({ lineId: line.id, body: common }, done);
    else addLine.mutate({ costCodeId, ...common }, done);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line ? `Edit ${line.code}` : 'Add a budget line'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="budget-line-form" loading={pending}>
            {line ? 'Save line' : 'Add line'}
          </Button>
        </>
      }
    >
      <form id="budget-line-form" className="stack" onSubmit={save} noValidate>
        {line ? null : (
          <Select
            label="Cost code"
            placeholder="Choose a cost code"
            required
            options={availableCodes.map((c) => ({
              value: c.id,
              label: `${c.code} ${c.description}`,
            }))}
            value={costCodeId}
            onChange={(e) => setCostCodeId(e.target.value)}
          />
        )}
        <TextField
          label="Original budget (AUD ex GST)"
          inputMode="decimal"
          required
          value={original}
          onChange={(e) => setOriginal(e.target.value)}
        />
        <TextField
          label="Note"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Checkbox
          label="This line is margin"
          hint="Margin lines are hidden from people without margin access."
          checked={isMargin}
          onChange={(e) => setIsMargin(e.target.checked)}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={addLine.error ?? updateLine.error} title="We couldn't save the line" />
      </form>
    </Dialog>
  );
}
