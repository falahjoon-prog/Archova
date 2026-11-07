'use client';

import { useState, type FormEvent } from 'react';
import { Button, Select, TextField } from '@archova/ui';
import { Plus, Trash2 } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import type { KeyDates } from '../data/api';
import { useUpdateKeyDates } from '../hooks/useSchedule';
import { REASON_LABELS } from '../lib/labels';
import { LD_RATE, draftOf, movesTarget, toPatch, type KeyDatesDraft } from '../lib/patch';

const MAX_SECTIONS = 20;

/** Edits the project's key dates and saves only what changed. Moving a target that was set asks why (SCH-AC1). */
export function KeyDatesForm({
  projectId,
  keyDates,
  onDone,
}: {
  projectId: string;
  keyDates: KeyDates;
  onDone: () => void;
}) {
  const save = useUpdateKeyDates(projectId);
  const [d, setD] = useState<KeyDatesDraft>(() => draftOf(keyDates));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof KeyDatesDraft>(key: K, value: KeyDatesDraft[K]) =>
    setD((x) => ({ ...x, [key]: value }));
  const setSection = (i: number, patch: Partial<KeyDatesDraft['sections'][number]>) =>
    setD((x) => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const needsReason = movesTarget(keyDates, d);
  const server = serverFieldErrors(save.error);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (d.ldRatePerDay && !LD_RATE.test(d.ldRatePerDay))
      next.ldRatePerDay = 'Enter dollars and cents, like 4500 or 4500.50.';
    if (needsReason && !d.reason) next.reason = 'Say why the target moved.';
    d.sections.forEach((s, i) => {
      if (!s.name.trim()) next[`section-${i}`] = 'Give the section a name.';
    });
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = toPatch(keyDates, d);
    if (Object.keys(body).length === 0) return onDone();
    save.mutate({ version: keyDates.version, body }, { onSuccess: onDone });
  }

  const err = (k: string) => errors[k] ?? server[k];
  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="Key dates">
      <ErrorAlert error={save.error} title="We couldn't save the key dates" />
      <div className="form-row">
        <TextField
          label="Site possession"
          type="date"
          value={d.possessionDate}
          onChange={(e) => set('possessionDate', e.target.value)}
          error={err('possessionDate')}
        />
        <TextField
          label="PC target"
          type="date"
          hint="Practical completion under the contract."
          value={d.pcTarget}
          onChange={(e) => set('pcTarget', e.target.value)}
          error={err('pcTarget')}
        />
      </div>
      <div className="form-row">
        <TextField
          label="PC actual"
          type="date"
          hint="Set when PC is certified."
          value={d.pcActual}
          onChange={(e) => set('pcActual', e.target.value)}
          error={err('pcActual')}
        />
        <TextField
          label="End of defects liability"
          type="date"
          value={d.dlpEnd}
          onChange={(e) => set('dlpEnd', e.target.value)}
          error={err('dlpEnd')}
        />
      </div>
      <TextField
        label="Liquidated damages per day (AUD)"
        inputMode="decimal"
        placeholder="4500"
        value={d.ldRatePerDay}
        onChange={(e) => set('ldRatePerDay', e.target.value)}
        error={err('ldRatePerDay')}
      />

      <fieldset className="key-sections">
        <legend className="panel-heading">Sectional completion</legend>
        {d.sections.length === 0 ? (
          <p className="u-muted">
            No sections. Add one for each separable portion in the contract.
          </p>
        ) : null}
        {d.sections.map((s, i) => (
          <div key={s.id ?? `new-${i}`} className="key-sections__row">
            <TextField
              label="Section name"
              value={s.name}
              maxLength={120}
              onChange={(e) => setSection(i, { name: e.target.value })}
              error={err(`section-${i}`)}
            />
            <TextField
              label="Target"
              type="date"
              value={s.targetDate}
              onChange={(e) => setSection(i, { targetDate: e.target.value })}
            />
            <TextField
              label="Actual"
              type="date"
              value={s.actualDate}
              onChange={(e) => setSection(i, { actualDate: e.target.value })}
            />
            <Button
              type="button"
              variant="secondary"
              aria-label={`Remove section ${s.name || i + 1}`}
              onClick={() =>
                setD((x) => ({ ...x, sections: x.sections.filter((_, j) => j !== i) }))
              }
            >
              <Trash2 size={16} aria-hidden="true" />
            </Button>
          </div>
        ))}
        {d.sections.length < MAX_SECTIONS ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setD((x) => ({
                  ...x,
                  sections: [...x.sections, { name: '', targetDate: '', actualDate: '' }],
                }))
              }
            >
              <Plus size={16} aria-hidden="true" /> Add section
            </Button>
          </div>
        ) : null}
      </fieldset>

      {needsReason ? (
        <Select
          label="Why is a target moving?"
          placeholder="Choose a reason"
          options={Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label }))}
          value={d.reason}
          onChange={(e) => set('reason', e.target.value as KeyDatesDraft['reason'])}
          error={err('reason')}
          required
        />
      ) : null}
      <TextField
        label="Note (optional)"
        hint="Kept with the change, for example the EOT number."
        value={d.note}
        maxLength={1000}
        onChange={(e) => set('note', e.target.value)}
      />
      <div className="row-actions">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save key dates'}
        </Button>
      </div>
    </form>
  );
}
