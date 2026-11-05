'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  Select,
  SkeletonRows,
  StatusPill,
  Textarea,
  TextField,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { formatLocalDate } from '@/shared/lib/format';
import { useForm, usePrequalMutations } from '../hooks/usePrequal';
import {
  QUALIFICATION_LABELS,
  scoreText,
  STATUS_LABELS,
  unanswered,
  type AnswerValue,
  type Answers,
  type Prequalification,
  type PrequalQuestion,
} from '../lib/types';
import { QUALIFICATION_TONE } from './tones';

function Question({
  q,
  value,
  disabled,
  missing,
  onChange,
}: {
  q: PrequalQuestion;
  value: AnswerValue | undefined;
  disabled: boolean;
  missing: boolean;
  onChange: (v: AnswerValue) => void;
}) {
  const label = q.required ? q.prompt : `${q.prompt} (optional)`;
  const error = missing ? 'Answer this question' : undefined;
  if (q.type === 'yes_no')
    return (
      <Select
        label={label}
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
        placeholder="Choose"
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
        disabled={disabled}
        error={error}
      />
    );
  if (q.type === 'select')
    return (
      <Select
        label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="Choose"
        options={q.options.map((o) => ({ value: o, label: o }))}
        disabled={disabled}
        error={error}
      />
    );
  if (q.type === 'text')
    return (
      <Textarea
        label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
        rows={3}
        disabled={disabled}
        error={error}
      />
    );
  return (
    <TextField
      label={label}
      type={q.type === 'date' ? 'date' : 'number'}
      inputMode={q.type === 'number' ? 'decimal' : undefined}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') return onChange(null);
        onChange(q.type === 'number' ? Number(v) : v);
      }}
      disabled={disabled}
      error={error}
    />
  );
}

function Decision({ form, onDone }: { form: Prequalification; onDone: () => void }) {
  const m = usePrequalMutations();
  const [note, setNote] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const error = m.approve.error ?? m.reject.error;
  const busy = m.approve.isPending || m.reject.isPending;
  return (
    <div className="stack">
      <h3 className="u-h3">Decision</h3>
      <p className="u-caption">
        A person decides. The points are a guide only and nothing is approved or rejected for you.
      </p>
      <Textarea
        label="Note"
        hint="Required if you don’t approve it."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        rows={3}
      />
      <TextField
        label="Approved until"
        hint="Optional. Leave blank to use the form’s usual period."
        type="date"
        value={expiresOn}
        onChange={(e) => setExpiresOn(e.target.value)}
      />
      {problem ? <Alert tone="danger" title={problem} /> : null}
      {error ? <ErrorAlert error={error} title="We couldn’t record the decision" /> : null}
      <div className="prequal__actions">
        <Button
          disabled={busy}
          onClick={() => m.approve.mutate({ form, note, expiresOn }, { onSuccess: onDone })}
        >
          Approve
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (!note.trim()) return setProblem('Say why this form isn’t approved.');
            setProblem(null);
            m.reject.mutate({ form, note }, { onSuccess: onDone });
          }}
        >
          Don’t approve
        </Button>
      </div>
    </div>
  );
}

function Body({
  form,
  companyName,
  canDecide,
  onClose,
}: {
  form: Prequalification;
  companyName: string;
  canDecide: boolean;
  onClose: () => void;
}) {
  const m = usePrequalMutations();
  const [answers, setAnswers] = useState<Answers>(form.answers);
  const [trades, setTrades] = useState(form.trades.join(', '));
  const [showMissing, setShowMissing] = useState(false);
  const draft = form.status === 'draft';
  const tradeList = trades
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const missing = new Set(showMissing ? unanswered(form.questions, answers) : []);
  const score = scoreText(form);
  const error = m.save.error ?? m.submit.error;
  const sections = [...new Set(form.questions.map((q) => q.section))];

  return (
    <div className="stack">
      <div className="prequal__pills">
        <StatusPill tone={QUALIFICATION_TONE[form.qualification]}>
          {form.status === 'approved' || form.status === 'rejected'
            ? QUALIFICATION_LABELS[form.qualification]
            : STATUS_LABELS[form.status]}
        </StatusPill>
        {score ? <span className="u-caption">{score}</span> : null}
        {form.expiresOn ? (
          <span className="u-caption">Approved until {formatLocalDate(form.expiresOn)}</span>
        ) : null}
      </div>
      <p className="u-caption">
        {companyName} · {form.templateName}, version {form.templateVersion}
      </p>
      {form.concerns.length ? (
        <Alert tone="warning" title="Answers to look at before deciding">
          <ul>
            {form.concerns.map((id) => (
              <li key={id}>{form.questions.find((q) => q.id === id)?.prompt ?? id}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {form.decisionNote ? (
        <Alert tone="info" title="Decision note">
          {form.decisionNote}
        </Alert>
      ) : null}
      <TextField
        label="Trades"
        hint="Separate with commas."
        value={trades}
        onChange={(e) => setTrades(e.target.value)}
        disabled={!draft}
        maxLength={400}
      />
      {sections.map((section) => (
        <fieldset key={section || 'general'} className="prequal__section">
          {section ? <legend className="u-h3">{section}</legend> : null}
          {form.questions
            .filter((q) => q.section === section)
            .map((q) => (
              <Question
                key={q.id}
                q={q}
                value={answers[q.id]}
                disabled={!draft}
                missing={missing.has(q.id)}
                onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              />
            ))}
        </fieldset>
      ))}
      {error ? (
        <ErrorAlert
          error={error}
          title={
            isApiError(error, 409)
              ? 'Someone changed this form. Close it and open it again.'
              : 'We couldn’t save the form'
          }
        />
      ) : null}
      {draft ? (
        <div className="prequal__actions">
          <Button
            variant="secondary"
            disabled={m.save.isPending || m.submit.isPending}
            onClick={() => m.save.mutate({ form, answers, trades: tradeList })}
          >
            {m.save.isPending ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            disabled={m.save.isPending || m.submit.isPending}
            onClick={() => {
              if (unanswered(form.questions, answers).length) return setShowMissing(true);
              m.submit.mutate({ form, answers, trades: tradeList }, { onSuccess: onClose });
            }}
          >
            {m.submit.isPending ? 'Submitting…' : 'Submit for a decision'}
          </Button>
        </div>
      ) : null}
      {form.status === 'submitted' ? (
        canDecide ? (
          <Decision form={form} onDone={onClose} />
        ) : (
          <p className="u-muted">An admin will approve or decline this form.</p>
        )
      ) : null}
    </div>
  );
}

export function FormDialog({
  formId,
  companyName,
  canDecide,
  onClose,
}: {
  formId: string;
  companyName: string;
  canDecide: boolean;
  onClose: () => void;
}) {
  const form = useForm(formId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Prequalification"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {form.isPending ? <SkeletonRows rows={4} label="Loading the form…" /> : null}
      {form.isError ? <ErrorAlert error={form.error} title="We couldn’t open the form" /> : null}
      {form.data ? (
        // Keyed on the version so a refetch after saving resets what is on screen to what is stored.
        <Body
          key={form.data.version}
          form={form.data}
          companyName={companyName}
          canDecide={canDecide}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}
