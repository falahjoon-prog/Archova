'use client';

import { InductionsIcon as ListChecks } from '@archova/ui/icons';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { serverFieldErrors } from '@/shared/lib/forms';
import { usePrequalMutations, usePrequalSettings, useTemplates } from '../hooks/usePrequal';
import {
  blankQuestion,
  nextQuestionId,
  normaliseQuestion,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type PrequalQuestion,
  type PrequalTemplate,
  type QuestionType,
} from '../lib/types';

function QuestionEditor({
  q,
  index,
  onChange,
  onRemove,
}: {
  q: PrequalQuestion;
  index: number;
  onChange: (q: PrequalQuestion) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const set = <K extends keyof PrequalQuestion>(k: K, v: PrequalQuestion[K]) =>
    onChange({ ...q, [k]: v });
  return (
    <fieldset className="prequal__section">
      <legend className="u-h3">Question {n}</legend>
      <TextField
        label="Question"
        value={q.prompt}
        onChange={(e) => set('prompt', e.target.value)}
        maxLength={1000}
        required
      />
      <TextField
        label="Section"
        hint="Optional heading to group questions, such as “Insurance”."
        value={q.section}
        onChange={(e) => set('section', e.target.value)}
        maxLength={100}
      />
      <Select
        label="Answer type"
        value={q.type}
        onChange={(e) => set('type', e.target.value as QuestionType)}
        options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
      />
      {q.type === 'select' ? (
        <TextField
          label="Choices"
          hint="Separate with commas. At least two."
          value={q.options.join(', ')}
          onChange={(e) =>
            set(
              'options',
              e.target.value.split(',').map((o) => o.trimStart()),
            )
          }
        />
      ) : null}
      <Checkbox
        label="Must be answered"
        checked={q.required}
        onChange={(e) => set('required', e.target.checked)}
      />
      {q.type === 'yes_no' ? (
        <>
          <Select
            label="Answer you want"
            value={q.expect ?? ''}
            onChange={(e) => set('expect', (e.target.value || null) as PrequalQuestion['expect'])}
            placeholder="Either is fine"
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />
          {q.expect ? (
            <>
              <TextField
                label="Points for that answer"
                type="number"
                min={0}
                max={100}
                value={String(q.points)}
                onChange={(e) =>
                  set('points', Math.max(0, Math.min(100, Math.trunc(Number(e.target.value) || 0))))
                }
              />
              <Checkbox
                label="Flag to the person deciding if it isn’t answered that way"
                checked={q.critical}
                onChange={(e) => set('critical', e.target.checked)}
              />
            </>
          ) : null}
        </>
      ) : null}
      <div>
        <Button variant="secondary" onClick={onRemove}>
          Remove<span className="u-visually-hidden"> question {n}</span>
        </Button>
      </div>
    </fieldset>
  );
}

function TemplateDialog({
  template,
  onClose,
}: {
  /** The draft being edited, or `null` for a new form. */
  template: PrequalTemplate | null;
  onClose: () => void;
}) {
  const m = usePrequalMutations();
  const [name, setName] = useState(template?.name ?? '');
  const [months, setMonths] = useState(String(template?.validityMonths ?? 12));
  const [questions, setQuestions] = useState<PrequalQuestion[]>(
    template?.questions.length ? template.questions : [blankQuestion(1)],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const mutation = template ? m.updateTemplate : m.createTemplate;
  const server = serverFieldErrors(mutation.error);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProblem(null);
    const trimmed = name.trim();
    const validityMonths = Number(months);
    if (!trimmed) return setProblem('Give the form a name.');
    if (!Number.isInteger(validityMonths) || validityMonths < 1 || validityMonths > 60)
      return setProblem('Approvals last from 1 to 60 months.');
    const cleaned = questions.map(normaliseQuestion);
    if (cleaned.some((q) => !q.prompt)) return setProblem('Every question needs some text.');
    if (cleaned.some((q) => q.type === 'select' && new Set(q.options).size < 2))
      return setProblem('A “Choose one” question needs at least two different choices.');
    if (template)
      m.updateTemplate.mutate(
        { t: template, body: { name: trimmed, validityMonths, questions: cleaned } },
        { onSuccess: onClose },
      );
    else
      m.createTemplate.mutate(
        { name: trimmed, validityMonths, questions: cleaned },
        { onSuccess: onClose },
      );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? 'Edit form' : 'New prequalification form'}
      description="You can change a form until you publish it. After that, make a new version."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="prequal-template" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save form'}
          </Button>
        </>
      }
    >
      <form id="prequal-template" className="stack" onSubmit={onSubmit} noValidate>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={server.name}
          maxLength={200}
          required
        />
        <TextField
          label="An approval lasts (months)"
          type="number"
          min={1}
          max={60}
          value={months}
          onChange={(e) => setMonths(e.target.value)}
          error={server.validityMonths}
        />
        {questions.map((q, i) => (
          <QuestionEditor
            key={q.id}
            q={q}
            index={i}
            onChange={(next) => setQuestions((qs) => qs.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
          />
        ))}
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              setQuestions((qs) => [...qs, { ...blankQuestion(0), id: nextQuestionId(qs) }])
            }
            disabled={questions.length >= 100}
          >
            Add a question
          </Button>
        </div>
        {problem ? <Alert tone="danger" title={problem} /> : null}
        {mutation.isError && !Object.keys(server).length ? (
          <ErrorAlert
            error={mutation.error}
            title={
              isApiError(mutation.error, 409)
                ? 'That name is taken, or the form was published or changed. Close this and try again.'
                : 'We couldn’t save the form'
            }
          />
        ) : null}
      </form>
    </Dialog>
  );
}

function TemplateRow({ t, onEdit }: { t: PrequalTemplate; onEdit: (t: PrequalTemplate) => void }) {
  const m = usePrequalMutations();
  const busy = m.publishTemplate.isPending || m.newVersion.isPending;
  const error = m.publishTemplate.error ?? m.newVersion.error;
  return (
    <li className="prequal__row">
      <div className="prequal__head">
        <strong>
          {t.name} <span className="u-caption">version {t.version}</span>
        </strong>
        <StatusPill tone={t.published ? 'success' : 'neutral'}>
          {t.published ? 'Published' : 'Draft'}
        </StatusPill>
      </div>
      <span className="u-caption">
        {t.questions.length} {t.questions.length === 1 ? 'question' : 'questions'} · Approval lasts{' '}
        {t.validityMonths} {t.validityMonths === 1 ? 'month' : 'months'}
      </span>
      <div className="prequal__actions">
        {t.published ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => m.newVersion.mutate(t, { onSuccess: onEdit })}
          >
            Make a new version<span className="u-visually-hidden"> of {t.name}</span>
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onEdit(t)}>
              Edit<span className="u-visually-hidden"> {t.name}</span>
            </Button>
            <Button disabled={busy} onClick={() => m.publishTemplate.mutate(t)}>
              Publish<span className="u-visually-hidden"> {t.name}</span>
            </Button>
          </>
        )}
      </div>
      {error ? <ErrorAlert error={error} title="We couldn’t update the form" /> : null}
    </li>
  );
}

function TenderGateSetting() {
  const { query, update } = usePrequalSettings();
  if (query.isPending || query.isError) return null;
  return (
    <div className="stack">
      <Checkbox
        label="Only invite prequalified subcontractors to tender"
        checked={query.data.requireForTenders}
        disabled={update.isPending}
        onChange={(e) => update.mutate(e.target.checked)}
      />
      <ErrorAlert error={update.error} title="We couldn’t save that setting" />
    </div>
  );
}

export function TemplatesPanel() {
  const templates = useTemplates();
  const [dialog, setDialog] = useState<{ t: PrequalTemplate | null } | null>(null);
  return (
    <div className="stack">
      <TenderGateSetting />
      <div>
        <Button onClick={() => setDialog({ t: null })}>New form</Button>
      </div>
      {templates.isPending ? <SkeletonRows rows={3} label="Loading forms…" /> : null}
      {templates.isError ? (
        isApiError(templates.error, 403) ? (
          <p className="u-muted">You don’t have access to design forms.</p>
        ) : (
          <ErrorAlert error={templates.error} title="We couldn’t load the forms" />
        )
      ) : null}
      {templates.data && templates.data.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No forms yet"
          description="Write the questions you ask subcontractors, then publish the form to use it."
        />
      ) : null}
      {templates.data?.length ? (
        <ul className="prequal__list">
          {templates.data.map((t) => (
            <TemplateRow key={t.id} t={t} onEdit={(x) => setDialog({ t: x })} />
          ))}
        </ul>
      ) : null}
      {dialog ? <TemplateDialog template={dialog.t} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
