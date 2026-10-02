'use client';

import { useState, type FormEvent } from 'react';
import { CreateOrgRequestSchema, type Org } from '@archova/contracts';
import { Button, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { parseForm, serverFieldErrors, withoutEmpty, type FieldErrors } from '@/shared/lib/forms';
import { useCreateOrg } from '../hooks/useCreateOrg';

const MESSAGES = {
  name: 'Enter the organisation name.',
  slug: 'Use 3 to 48 lowercase letters, numbers or hyphens, starting and ending with a letter or number.',
};

export function NewOrgForm({ onCreated }: { onCreated: (org: Org) => void }) {
  const createOrg = useCreateOrg();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseForm(
      CreateOrgRequestSchema,
      withoutEmpty({ name: name.trim(), slug: slug.trim().toLowerCase() }),
      MESSAGES,
    );
    if (!parsed.ok) return setFieldErrors(parsed.fieldErrors);
    setFieldErrors({});
    createOrg.mutate(parsed.data, { onSuccess: onCreated });
  }

  const errors = { ...serverFieldErrors(createOrg.error), ...fieldErrors };
  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="New organisation">
      <ErrorAlert error={createOrg.error} title="We couldn't create the organisation" />
      <TextField
        label="Organisation name"
        name="name"
        autoComplete="organization"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <TextField
        label="Web address (optional)"
        name="slug"
        hint="Used in links, like archova.com.au/your-company. Leave blank to use the organisation name."
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        error={errors.slug}
        autoCapitalize="none"
        spellCheck={false}
      />
      <Button type="submit" loading={createOrg.isPending}>
        {createOrg.isPending ? 'Creating organisation…' : 'Create organisation'}
      </Button>
    </form>
  );
}
