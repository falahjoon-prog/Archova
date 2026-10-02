'use client';

import { useState, type FormEvent } from 'react';
import { AddProjectMemberRequestSchema } from '@archova/contracts';
import { Alert, Button, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { parseForm, serverFieldErrors, type FieldErrors } from '@/shared/lib/forms';
import { useAddProjectMember } from '../hooks/useProjectMutations';
import { useCompanies, usePermissionTemplates } from '../hooks/useProjectQueries';

const MESSAGES = {
  email: 'Enter the person’s email address, like name@company.com.au.',
  companyId: 'Choose the company they work for.',
  permissionTemplateId: 'Choose what they can do on this project.',
};

/** Adds an existing Archova user to the project with a company and permission template. */
export function AddMemberForm({ orgId, projectId }: { orgId: string; projectId: string }) {
  const companies = useCompanies(orgId);
  const templates = usePermissionTemplates(orgId);
  const addMember = useAddProjectMember(orgId, projectId);
  const [email, setEmail] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [permissionTemplateId, setPermissionTemplateId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [added, setAdded] = useState<string | null>(null);

  if (companies.isPending || templates.isPending)
    return <Loading label="Loading companies and templates…" />;
  if (companies.isError || templates.isError) {
    return (
      <ErrorAlert
        error={companies.error ?? templates.error}
        title="We couldn't load the add member form"
      />
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseForm(
      AddProjectMemberRequestSchema,
      { email: email.trim(), companyId, permissionTemplateId },
      MESSAGES,
    );
    if (!parsed.ok) return setFieldErrors(parsed.fieldErrors);
    setFieldErrors({});
    setAdded(null);
    addMember.mutate(parsed.data, {
      onSuccess: (member) => {
        setEmail('');
        setAdded(member.name || member.email);
      },
    });
  }

  const errors = { ...serverFieldErrors(addMember.error), ...fieldErrors };
  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="Add member">
      <ErrorAlert error={addMember.error} title="We couldn't add that person" />
      {added ? <Alert tone="success">{added} added to the project.</Alert> : null}
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="off"
        hint="They need an Archova account already."
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <div className="form-row">
        <Select
          label="Company"
          name="companyId"
          placeholder="Choose a company"
          options={companies.data.data.map((c) => ({ value: c.id, label: c.name }))}
          required
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          error={errors.companyId}
        />
        <Select
          label="Permission template"
          name="permissionTemplateId"
          placeholder="Choose a template"
          options={templates.data.data.map((t) => ({ value: t.id, label: t.name }))}
          required
          value={permissionTemplateId}
          onChange={(e) => setPermissionTemplateId(e.target.value)}
          error={errors.permissionTemplateId}
        />
      </div>
      <div>
        <Button type="submit" loading={addMember.isPending}>
          {addMember.isPending ? 'Adding member…' : 'Add member'}
        </Button>
      </div>
    </form>
  );
}
