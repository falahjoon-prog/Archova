'use client';

import { useState } from 'react';
import { Button, Checkbox, Select, TextField, Textarea } from '@archova/ui';
import { Plus, X } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { fileDownloadUrl, uploadFile } from '@/shared/lib/uploads';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { FormField } from '../data/api';

type Row = Record<string, string>;

/** One field of a form being filled in. `onChange` receives the new answer; a signature is handled by the caller. */
export function FieldInput({
  field,
  value,
  disabled,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  disabled: boolean;
  error?: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const label = field.required ? `${field.label} (required)` : field.label;
  const hint = field.help;
  switch (field.type) {
    case 'text':
      return (
        <TextField
          label={label}
          hint={hint}
          error={error}
          value={typeof value === 'string' ? value : ''}
          maxLength={500}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'longtext':
      return (
        <Textarea
          label={label}
          hint={hint}
          error={error}
          value={typeof value === 'string' ? value : ''}
          maxLength={5000}
          rows={4}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <TextField
          label={label}
          hint={hint}
          error={error}
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? String(value) : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <TextField
          label={label}
          hint={hint}
          error={error}
          type="date"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'checkbox':
      return (
        <Checkbox
          label={label}
          hint={error ?? hint}
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'select':
      return (
        <Select
          label={label}
          hint={hint}
          error={error}
          placeholder="Choose…"
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'checklist': {
      const ticked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="forms__group" disabled={disabled}>
          <legend>{label}</legend>
          {hint ? <p className="u-caption">{hint}</p> : null}
          {(field.options ?? []).map((o) => (
            <Checkbox
              key={o}
              label={o}
              checked={ticked.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...ticked, o] : ticked.filter((t) => t !== o))
              }
            />
          ))}
          {error ? <p role="alert">{error}</p> : null}
        </fieldset>
      );
    }
    case 'table':
      return (
        <TableInput
          field={field}
          label={label}
          rows={Array.isArray(value) ? (value as Row[]) : null}
          disabled={disabled}
          error={error}
          onChange={onChange}
        />
      );
    case 'photo':
      return (
        <PhotoInput
          label={label}
          ids={Array.isArray(value) ? (value as string[]) : []}
          disabled={disabled}
          error={error}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

function TableInput({
  field,
  label,
  rows,
  disabled,
  error,
  onChange,
}: {
  field: FormField;
  label: string;
  rows: Row[] | null;
  disabled: boolean;
  error?: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const columns = field.columns ?? [];
  const shown: Row[] = rows ?? Array.from({ length: field.rows ?? 3 }, () => ({}));
  const set = (next: Row[]) => onChange(next);
  return (
    <fieldset className="forms__group" disabled={disabled}>
      <legend>{label}</legend>
      {field.help ? <p className="u-caption">{field.help}</p> : null}
      <div className="forms__rows">
        {shown.map((row, i) => (
          <div className="forms__row" key={i}>
            <span className="forms__row-no" aria-hidden="true">
              {i + 1}
            </span>
            {columns.map((c) => (
              <Textarea
                key={c.key}
                label={c.label}
                rows={2}
                maxLength={1000}
                value={row[c.key] ?? ''}
                onChange={(e) =>
                  set(shown.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))
                }
              />
            ))}
            {shown.length > 1 ? (
              <Button
                type="button"
                variant="secondary"
                aria-label={`Remove row ${i + 1}`}
                onClick={() => set(shown.filter((_, j) => j !== i))}
              >
                <X size={20} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {shown.length < 50 ? (
        <Button type="button" variant="secondary" onClick={() => set([...shown, {}])}>
          <Plus size={20} aria-hidden="true" /> Add row
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}

function PhotoInput({
  label,
  ids,
  disabled,
  error,
  onChange,
}: {
  label: string;
  ids: string[];
  disabled: boolean;
  error?: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        const stored = await uploadFile(orgId, { file, projectId, module: 'forms' });
        added.push(stored.id);
      }
      onChange([...ids, ...added]);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    try {
      window.open(await fileDownloadUrl(orgId, id), '_blank', 'noopener');
    } catch (e) {
      setFailure(e);
    }
  }

  return (
    <fieldset className="forms__group" disabled={disabled}>
      <legend>{label}</legend>
      <ErrorAlert error={failure} title="We couldn't add the photo" />
      <ul className="forms__photos">
        {ids.map((id, i) => (
          <li key={id}>
            <Button type="button" variant="secondary" onClick={() => void open(id)}>
              Photo {i + 1}
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => onChange(ids.filter((x) => x !== id))}
            >
              <X size={20} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <label className="forms__upload">
        <span>{busy ? 'Adding…' : ids.length ? 'Add another photo' : 'Add photos'}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          disabled={busy || disabled || ids.length >= 20}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
