'use client';

import { useRef, useState } from 'react';
import { Button, Checkbox, Select, TextField } from '@archova/ui';
import { ChevronDown, ChevronUp, Plus, X } from '@archova/ui/icons';
import type { FormField } from '../data/api';
import { FIELD_TYPE_LABELS, moveItem, newField } from '../lib/fields';

const ADDABLE = Object.keys(FIELD_TYPE_LABELS) as FormField['type'][];
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 40);

/**
 * The field list of a template. Fields are added from the palette and reordered by dragging the handle or with the
 * Move up / Move down buttons (which are what keyboard and screen-reader users use).
 */
export function TemplateBuilder({
  fields,
  onChange,
  errors,
}: {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
  errors: Record<string, string>;
}) {
  const [adding, setAdding] = useState<FormField['type']>('text');
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const patch = (i: number, p: Partial<FormField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));

  return (
    <div className="stack">
      <div className="forms__palette">
        <Select
          label="Add a field"
          value={adding}
          options={ADDABLE.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}
          onChange={(e) => setAdding(e.target.value as FormField['type'])}
        />
        <Button type="button" onClick={() => onChange([...fields, newField(adding, fields)])}>
          <Plus size={20} aria-hidden="true" /> Add
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="u-caption">No fields yet. Add one above.</p>
      ) : (
        <ol className="forms__builder">
          {fields.map((f, i) => (
            <li
              key={f.key}
              className={`forms__builder-item${over === i ? ' forms__builder-item--over' : ''}`}
              onDragOver={(e) => {
                if (dragFrom.current === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null) onChange(moveItem(fields, dragFrom.current, i));
                dragFrom.current = null;
                setOver(null);
              }}
            >
              <div className="forms__builder-bar">
                <span
                  className="forms__handle"
                  draggable
                  title="Drag to reorder"
                  aria-hidden="true"
                  onDragStart={() => {
                    dragFrom.current = i;
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null;
                    setOver(null);
                  }}
                >
                  ⠿
                </span>
                <span className="forms__type">{FIELD_TYPE_LABELS[f.type]}</span>
                <span className="forms__builder-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Move ${f.label} up`}
                    disabled={i === 0}
                    onClick={() => onChange(moveItem(fields, i, i - 1))}
                  >
                    <ChevronUp size={20} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Move ${f.label} down`}
                    disabled={i === fields.length - 1}
                    onClick={() => onChange(moveItem(fields, i, i + 1))}
                  >
                    <ChevronDown size={20} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Remove ${f.label}`}
                    onClick={() => onChange(fields.filter((_, j) => j !== i))}
                  >
                    <X size={20} aria-hidden="true" />
                  </Button>
                </span>
              </div>
              <TextField
                label={f.type === 'heading' ? 'Heading' : 'Label'}
                value={f.label}
                maxLength={200}
                error={errors[`fields/${i}/label`]}
                onChange={(e) => patch(i, { label: e.target.value })}
                onBlur={() => {
                  // A field keeps its key once forms may use it; a brand-new default key follows the label.
                  const want = slug(f.label);
                  if (want && /^[a-z]+_\d+$/.test(f.key) && !fields.some((x) => x.key === want))
                    patch(i, { key: want });
                }}
              />
              <TextField
                label="Help text (optional)"
                value={f.help ?? ''}
                maxLength={500}
                onChange={(e) => patch(i, { help: e.target.value })}
              />
              {f.type !== 'heading' ? (
                <Checkbox
                  label="Required"
                  checked={f.required === true}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />
              ) : null}
              {f.type === 'select' || f.type === 'checklist' ? (
                <OptionsEditor
                  label={f.type === 'select' ? 'Choices' : 'Checklist items'}
                  options={f.options ?? []}
                  error={errors[`fields/${i}/options`]}
                  onChange={(options) => patch(i, { options })}
                />
              ) : null}
              {f.type === 'table' ? (
                <OptionsEditor
                  label="Columns"
                  options={(f.columns ?? []).map((c) => c.label)}
                  error={errors[`fields/${i}/columns`]}
                  onChange={(labels) =>
                    patch(i, {
                      columns: labels.map((label, j) => ({
                        key:
                          f.columns?.[j]?.key ??
                          `column_${Date.now().toString(36)}${j}`.slice(0, 40),
                        label,
                      })),
                    })
                  }
                />
              ) : null}
              {f.type === 'signature' ? (
                <TextField
                  label="Most people who can sign"
                  type="number"
                  min={1}
                  max={30}
                  value={String(f.slots ?? 1)}
                  onChange={(e) =>
                    patch(i, { slots: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })
                  }
                />
              ) : null}
              {errors[`fields/${i}/key`] ? <p role="alert">{errors[`fields/${i}/key`]}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function OptionsEditor({
  label,
  options,
  error,
  onChange,
}: {
  label: string;
  options: readonly string[];
  error?: string | undefined;
  onChange: (o: string[]) => void;
}) {
  return (
    <fieldset className="forms__group">
      <legend>{label}</legend>
      {options.map((o, i) => (
        <div key={i} className="forms__option">
          <TextField
            label={`${label} ${i + 1}`}
            value={o}
            maxLength={200}
            onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {options.length > 1 ? (
            <Button
              type="button"
              variant="secondary"
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(options.filter((_, j) => j !== i))}
            >
              <X size={20} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange([...options, ''])}>
        <Plus size={20} aria-hidden="true" /> Add
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
