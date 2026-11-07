'use client';

import { useState } from 'react';
import { Button, Checkbox, Dialog, Select, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import {
  FIELD_TYPE_LABELS,
  PREFILL_LABELS,
  fieldIdFor,
  hasChoices,
  type FormFieldType,
  type FormPrefillKey,
  type FormTemplate,
  type FormTemplateInput,
} from '../lib/types';

interface Draft {
  id: string;
  section: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  helpText: string;
  optionsText: string;
  prefillKey: FormPrefillKey | '';
}

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FormFieldType[];
const PREFILL = Object.keys(PREFILL_LABELS) as FormPrefillKey[];

const optionsOf = (text: string) =>
  text
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);

function toDrafts(t: FormTemplate | null): Draft[] {
  return (t?.fields ?? []).map((f) => ({
    id: f.id,
    section: f.section,
    label: f.label,
    type: f.type,
    required: f.required,
    helpText: f.helpText ?? '',
    optionsText: f.options.join('\n'),
    prefillKey: f.prefillKey ?? '',
  }));
}

export function toInput(
  name: string,
  category: string,
  description: string,
  drafts: Draft[],
): FormTemplateInput {
  return {
    name: name.trim(),
    category: category.trim() || null,
    description: description.trim() || null,
    fields: drafts.map((d) => ({
      id: d.id,
      section: d.section.trim() || 'General',
      label: d.label.trim(),
      type: d.type,
      required: d.required,
      helpText: d.helpText.trim() || null,
      options: hasChoices(d.type) ? optionsOf(d.optionsText) : [],
      prefillKey: d.prefillKey === '' ? null : d.prefillKey,
    })),
  };
}

/** Why a draft cannot be saved yet, or null. Mirrors the server's checks so the person sees it before saving. */
export function draftProblem(name: string, drafts: Draft[]): string | null {
  if (!name.trim()) return 'Name the form.';
  for (const [i, d] of drafts.entries()) {
    if (!d.label.trim()) return `Name field ${i + 1}.`;
    if (hasChoices(d.type)) {
      const o = optionsOf(d.optionsText);
      if (o.length < 1) return `Give "${d.label}" at least one option.`;
      if (new Set(o.map((x) => x.toLowerCase())).size !== o.length)
        return `Options on "${d.label}" must be different.`;
    }
  }
  return null;
}

/** Builds or edits a draft form: sections, typed fields, which are required, and what Nova may pre-fill. */
export function TemplateBuilderDialog({
  template,
  pending,
  error,
  onClose,
  onSave,
}: {
  template: FormTemplate | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: FormTemplateInput) => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(template));
  const problem = draftProblem(name, drafts);

  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((cur) => cur.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const move = (i: number, by: -1 | 1) =>
    setDrafts((cur) => {
      const j = i + by;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = () =>
    setDrafts((cur) => [
      ...cur,
      {
        id: fieldIdFor(
          `field ${cur.length + 1}`,
          cur.map((d) => d.id),
        ),
        section: cur.at(-1)?.section ?? 'General',
        label: '',
        type: 'text',
        required: false,
        helpText: '',
        optionsText: '',
        prefillKey: '',
      },
    ]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? `Edit ${template.name}` : 'New form template'}
      description="Add sections and fields in the order people should fill them in. It stays a draft until you publish it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={problem !== null || pending}
            onClick={() => onSave(toInput(name, category, description, drafts))}
          >
            {pending ? 'Saving…' : 'Save draft'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Form name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <TextField
          label="Category"
          value={category}
          maxLength={60}
          hint="For example Safety, Quality, Site admin or Handover."
          onChange={(e) => setCategory(e.target.value)}
        />
        <Textarea
          label="Description"
          rows={2}
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
        <ol className="forms-fields" aria-label="Fields">
          {drafts.map((d, i) => (
            <li key={d.id} className="forms-field">
              <div className="forms-field__grid">
                <TextField
                  label="Section"
                  value={d.section}
                  maxLength={100}
                  onChange={(e) => patch(i, { section: e.target.value })}
                />
                <TextField
                  label="Field label"
                  value={d.label}
                  maxLength={300}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
                <Select
                  label="Answer type"
                  value={d.type}
                  options={TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}
                  onChange={(e) => patch(i, { type: e.target.value as FormFieldType })}
                />
                <Select
                  label="Nova can pre-fill from"
                  value={d.prefillKey}
                  placeholder="Nothing"
                  options={PREFILL.map((k) => ({ value: k, label: PREFILL_LABELS[k] }))}
                  onChange={(e) => patch(i, { prefillKey: e.target.value as FormPrefillKey | '' })}
                />
              </div>
              {hasChoices(d.type) ? (
                <Textarea
                  label="Options"
                  rows={3}
                  value={d.optionsText}
                  hint="One option per line."
                  onChange={(e) => patch(i, { optionsText: e.target.value })}
                />
              ) : null}
              <TextField
                label="Help text"
                value={d.helpText}
                maxLength={500}
                onChange={(e) => patch(i, { helpText: e.target.value })}
              />
              <div className="row-actions">
                <Checkbox
                  label="Required"
                  checked={d.required}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />
                <Button
                  variant="tertiary"
                  aria-label={`Move field ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  Move up
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={`Move field ${i + 1} down`}
                  disabled={i === drafts.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Move down
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={`Remove field ${i + 1}`}
                  onClick={() => setDrafts((cur) => cur.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Button variant="secondary" onClick={add}>
            Add field
          </Button>
        </div>
        {problem && drafts.length > 0 ? <p role="status">{problem}</p> : null}
        <ErrorAlert error={error} title="We couldn't save the form" />
      </div>
    </Dialog>
  );
}
