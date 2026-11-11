'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Select, StatusPill, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { fileDownloadUrl } from '@/shared/lib/uploads';
import { useSubmissionMutations } from '../hooks/useForms';
import {
  STATUS_LABELS,
  bySection,
  type AnswerValue,
  type Answers,
  type FormField,
  type FormSubmissionDetail,
} from '../lib/types';
import { FlagPills } from './FlagPills';

function FieldInput({
  field,
  value,
  disabled,
  missing,
  suggested,
  onChange,
}: {
  field: FormField;
  value: AnswerValue | undefined;
  disabled: boolean;
  missing: boolean;
  suggested: boolean;
  onChange: (v: AnswerValue | null) => void;
}) {
  const label = field.required ? `${field.label} (required)` : field.label;
  const error = missing ? 'Required before you can submit' : undefined;
  const common = {
    label,
    hint: field.helpText ?? undefined,
    disabled,
    ...(error ? { error } : {}),
  };
  switch (field.type) {
    case 'long_text':
      return (
        <Textarea
          {...common}
          aiFilled={suggested}
          rows={4}
          value={(value as string) ?? ''}
          maxLength={5000}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'number':
      return (
        <TextField
          {...common}
          type="number"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <TextField
          {...common}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'yes_no':
      return (
        <Select
          {...common}
          value={value === undefined ? '' : value ? 'yes' : 'no'}
          placeholder="Not answered"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
        />
      );
    case 'single_select':
      return (
        <Select
          {...common}
          value={(value as string) ?? ''}
          placeholder="Choose…"
          options={field.options.map((o) => ({ value: o, label: o }))}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'multi_select': {
      const picked = Array.isArray(value) ? value : [];
      return (
        <fieldset className="stack--tight" disabled={disabled}>
          <legend>{label}</legend>
          {field.options.map((o) => (
            <Checkbox
              key={o}
              label={o}
              checked={picked.includes(o)}
              onChange={(e) => {
                const next = e.target.checked ? [...picked, o] : picked.filter((p) => p !== o);
                onChange(next.length === 0 ? null : next);
              }}
            />
          ))}
          {error ? <p role="alert">{error}</p> : null}
        </fieldset>
      );
    }
    default:
      return (
        <TextField
          {...common}
          value={(value as string) ?? ''}
          maxLength={500}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
  }
}

/** One form, filled in section by section. Saves progress, submits when the required fields are in, and takes Nova's offers. */
export function SubmissionPanel({ detail }: { detail: FormSubmissionDetail }) {
  const { orgId } = useCurrentOrg();
  const { submission: sub } = detail;
  const m = useSubmissionMutations(sub.id);
  const [answers, setAnswers] = useState<Answers>(detail.answers as Answers);
  const [files, setFiles] = useState<string[]>(detail.fileIds);
  const [applied, setApplied] = useState<string[]>([]);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    setAnswers(detail.answers as Answers);
    setFiles(detail.fileIds);
  }, [detail.answers, detail.fileIds, sub.updatedAt]);

  const set = (id: string, v: AnswerValue | null) =>
    setAnswers((cur) => {
      const next = { ...cur };
      if (v === null) delete next[id];
      else next[id] = v;
      return next;
    });

  // Required fields still empty on this screen (what was typed but not yet saved counts).
  const stillMissing = detail.fields
    .filter(
      (f) =>
        f.required &&
        (answers[f.id] === undefined ||
          answers[f.id] === '' ||
          (Array.isArray(answers[f.id]) && (answers[f.id] as string[]).length === 0)),
    )
    .map((f) => f.id);
  const body = () => ({
    answers: Object.fromEntries(detail.fields.map((f) => [f.id, answers[f.id] ?? null])),
    fileIds: files,
  });
  const save = () => m.save.mutate(body());
  const submit = () => {
    setTried(true);
    if (stillMissing.length > 0) return;
    m.save.mutate(body(), { onSuccess: () => m.submit.mutate() });
  };
  const suggestions = m.suggest.data ?? [];
  const offered = suggestions.filter((s) => !applied.includes(s.fieldId));
  const labelOf = (id: string) => detail.fields.find((f) => f.id === id)?.label ?? id;
  const apply = (ids: string[]) => {
    for (const s of suggestions) if (ids.includes(s.fieldId)) set(s.fieldId, s.value);
    setApplied((cur) => [...cur, ...ids]);
  };

  return (
    <div className="stack">
      <div className="row-actions">
        <StatusPill
          tone={
            sub.status === 'closed' ? 'success' : sub.status === 'submitted' ? 'info' : 'neutral'
          }
        >
          {STATUS_LABELS[sub.status]}
        </StatusPill>
        <FlagPills flags={sub.flags} daysLate={sub.daysLate} />
        {sub.dueDate ? <span>Due {sub.dueDate}</span> : null}
      </div>
      <ErrorAlert
        error={
          m.save.error ?? m.submit.error ?? m.review.error ?? m.suggest.error ?? m.upload.error
        }
        title="Something went wrong with this form"
      />
      {detail.canFill ? (
        <Alert tone="info" title="Nova">
          <div className="stack--tight">
            <p>
              {sub.missingRequiredCount > 0
                ? `${sub.missingRequiredCount} required ${sub.missingRequiredCount === 1 ? 'field is' : 'fields are'} still empty.`
                : 'Every required field is answered.'}{' '}
              Nova can fill fields from the project
              {sub.relatedType ? ' and the linked incident' : ''}. You review before anything is
              saved.
            </p>
            <div className="row-actions">
              <Button
                variant="secondary"
                disabled={m.suggest.isPending}
                onClick={() => {
                  setApplied([]);
                  m.suggest.mutate();
                }}
              >
                {m.suggest.isPending ? 'Looking…' : 'Suggest answers'}
              </Button>
              {offered.length > 1 ? (
                <Button variant="tertiary" onClick={() => apply(offered.map((s) => s.fieldId))}>
                  Apply all
                </Button>
              ) : null}
            </div>
            {m.suggest.isSuccess && suggestions.length === 0 ? (
              <p role="status">Nothing to suggest for the empty fields.</p>
            ) : null}
            {offered.length > 0 ? (
              <ul>
                {offered.map((s) => (
                  <li key={s.fieldId}>
                    {labelOf(s.fieldId)}:{' '}
                    <strong>{Array.isArray(s.value) ? s.value.join(', ') : String(s.value)}</strong>{' '}
                    ({s.source}){' '}
                    <Button
                      variant="tertiary"
                      aria-label={`Use suggestion for ${labelOf(s.fieldId)}`}
                      onClick={() => apply([s.fieldId])}
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Alert>
      ) : null}
      {bySection(detail.fields).map((g) => (
        <section key={g.section} className="stack" aria-label={g.section}>
          <h3>{g.section}</h3>
          {g.fields.map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              value={answers[f.id]}
              disabled={!detail.canFill}
              missing={tried && stillMissing.includes(f.id)}
              suggested={applied.includes(f.id)}
              onChange={(v) => set(f.id, v)}
            />
          ))}
        </section>
      ))}
      <section className="stack--tight" aria-label="Attachments">
        <h3>Attachments</h3>
        {files.length === 0 ? <p>No attachments.</p> : null}
        <ul>
          {files.map((id, i) => (
            <li key={id}>
              <Button
                variant="tertiary"
                onClick={async () =>
                  window.open(await fileDownloadUrl(orgId, id), '_blank', 'noopener')
                }
              >
                Attachment {i + 1}
              </Button>{' '}
              {detail.canFill ? (
                <Button
                  variant="tertiary"
                  aria-label={`Remove attachment ${i + 1}`}
                  onClick={() => setFiles((cur) => cur.filter((f) => f !== id))}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {detail.canFill ? (
          <label className="forms-upload">
            <span>{m.upload.isPending ? 'Uploading…' : 'Add a photo or file'}</span>
            <input
              type="file"
              disabled={m.upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  m.upload.mutate(file, { onSuccess: (id) => setFiles((cur) => [...cur, id]) });
              }}
            />
          </label>
        ) : null}
      </section>
      <div className="row-actions">
        {detail.canFill ? (
          <>
            <Button variant="secondary" disabled={m.save.isPending} onClick={save}>
              {m.save.isPending ? 'Saving…' : 'Save progress'}
            </Button>
            <Button disabled={m.save.isPending || m.submit.isPending} onClick={submit}>
              Submit
            </Button>
          </>
        ) : null}
        {detail.canClose ? (
          <>
            <Button
              variant="secondary"
              disabled={m.review.isPending}
              onClick={() => m.review.mutate('return')}
            >
              Return for changes
            </Button>
            <Button disabled={m.review.isPending} onClick={() => m.review.mutate('close')}>
              Close
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
