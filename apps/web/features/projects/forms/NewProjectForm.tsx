'use client';

import { useState, type FormEvent } from 'react';
import { CreateProjectRequestSchema, type Project } from '@archova/contracts';
import { Alert, Button, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { parseForm, serverFieldErrors, withoutEmpty, type FieldErrors } from '@/shared/lib/forms';
import { useCreateProject } from '../hooks/useProjectMutations';
import { AU_STATE_OPTIONS } from '../lib/labels';

const MESSAGES = {
  name: 'Enter a project name.',
  number: 'Use 50 characters or fewer.',
  state: 'Choose a state or territory.',
};

export function NewProjectForm({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated?: (project: Project) => void;
}) {
  const createProject = useCreateProject(orgId);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [state, setState] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<Project | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseForm(
      CreateProjectRequestSchema,
      withoutEmpty({ name: name.trim(), number: number.trim(), state }),
      MESSAGES,
    );
    if (!parsed.ok) return setFieldErrors(parsed.fieldErrors);
    setFieldErrors({});
    setCreated(null);
    createProject.mutate(parsed.data, {
      onSuccess: (project) => {
        setName('');
        setNumber('');
        setState('');
        setCreated(project);
        onCreated?.(project);
      },
    });
  }

  const errors = { ...serverFieldErrors(createProject.error), ...fieldErrors };
  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="New project">
      <ErrorAlert error={createProject.error} title="We couldn't create the project" />
      {created ? <Alert tone="success">Project “{created.name}” created.</Alert> : null}
      <TextField
        label="Project name"
        name="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <div className="form-row">
        <TextField
          label="Project number (optional)"
          name="number"
          hint="Your internal job number, like 2026-014."
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          error={errors.number}
        />
        <Select
          label="State or territory (optional)"
          name="state"
          placeholder="Not set"
          options={AU_STATE_OPTIONS}
          value={state}
          onChange={(e) => setState(e.target.value)}
          error={errors.state}
        />
      </div>
      <div>
        <Button type="submit" loading={createProject.isPending}>
          {createProject.isPending ? 'Creating project…' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}
