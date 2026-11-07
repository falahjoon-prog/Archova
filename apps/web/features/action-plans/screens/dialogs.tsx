'use client';

import { useState } from 'react';
import { Button, Dialog, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { usePlanTemplates } from '../hooks/useActionPlans';
import type { PlanInput, StepInput } from '../lib/types';

/** One step per line; a blank line is ignored. */
export const stepsFromText = (text: string): StepInput[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((title) => ({ title: title.slice(0, 300) }));

export function NewPlanDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: PlanInput) => void;
}) {
  const templates = usePlanTemplates(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [steps, setSteps] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="New action plan"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                title: title.trim(),
                description: description.trim() || undefined,
                dueDate: dueDate || undefined,
                ...(templateId ? { templateId } : { items: stepsFromText(steps) }),
              })
            }
          >
            {pending ? 'Saving…' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          label="What is this plan for? (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        {(templates.data ?? []).length > 0 ? (
          <Select
            label="Start from a template"
            value={templateId}
            placeholder="No template"
            options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            onChange={(e) => setTemplateId(e.target.value)}
          />
        ) : null}
        {templateId ? null : (
          <Textarea
            label="Steps, one per line (optional)"
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
          />
        )}
        <ErrorAlert error={error} title="We couldn't create the plan" />
      </div>
    </Dialog>
  );
}

export function AddStepDialog({
  dir,
  pending,
  error,
  onClose,
  onSave,
}: {
  dir: ReturnType<typeof useProjectDirectory>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: StepInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [dueDate, setDueDate] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a step"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                title: title.trim(),
                assigneeCompanyId: company || undefined,
                dueDate: dueDate || undefined,
              })
            }
          >
            {pending ? 'Saving…' : 'Add step'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Step" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select
          label="Assign to"
          value={company}
          placeholder="Not assigned"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't add the step" />
      </div>
    </Dialog>
  );
}

export function TemplateDialog({
  pending,
  error,
  defaultName,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  defaultName: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Save as template"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || pending} onClick={() => onSave(name.trim())}>
            {pending ? 'Saving…' : 'Save template'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="u-m-0">
          The steps are kept without who they were assigned to or when they were due.
        </p>
        <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the template" />
      </div>
    </Dialog>
  );
}

export function NoteDialog({
  title,
  pending,
  error,
  onClose,
  onSave,
}: {
  title: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSave(note.trim())}>
            {pending ? 'Saving…' : 'Mark done'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea
          label="What was done? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't update the step" />
      </div>
    </Dialog>
  );
}
