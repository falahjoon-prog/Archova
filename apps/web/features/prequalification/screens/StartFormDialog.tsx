'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { isApiError } from '@/shared/lib/errors';
import { useCompanies, usePrequalMutations, useTemplates } from '../hooks/usePrequal';

/** Start a form for a company on a published template. The company's answers are filled in on the next screen. */
export function StartFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (formId: string) => void;
}) {
  const companies = useCompanies();
  const templates = useTemplates();
  const m = usePrequalMutations();
  const [companyId, setCompanyId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [trades, setTrades] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const published = (templates.data ?? []).filter((t) => t.published);
  const subs = (companies.data ?? []).filter((c) => !c.isOwnCompany);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProblem(null);
    if (!companyId) return setProblem('Choose a company.');
    if (!templateId) return setProblem('Choose a form.');
    m.create.mutate(
      {
        companyId,
        templateId,
        trades: trades
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      },
      { onSuccess: (form) => onCreated(form.id) },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Start a prequalification"
      description="Pick the company and the form it will answer."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="prequal-start" disabled={m.create.isPending}>
            {m.create.isPending ? 'Starting…' : 'Start form'}
          </Button>
        </>
      }
    >
      <form id="prequal-start" className="stack" onSubmit={onSubmit} noValidate>
        <Select
          label="Company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          placeholder="Choose a company"
          options={subs.map((c) => ({ value: c.id, label: c.name }))}
          hint={companies.isError ? 'We couldn’t load your companies.' : undefined}
        />
        <Select
          label="Form"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          placeholder="Choose a form"
          options={published.map((t) => ({
            value: t.id,
            label: `${t.name} (version ${t.version})`,
          }))}
          hint={
            templates.data && published.length === 0
              ? 'No published forms yet. An admin needs to publish one first.'
              : undefined
          }
        />
        <TextField
          label="Trades"
          hint="Optional. Separate with commas, such as “Electrical, Data”."
          value={trades}
          onChange={(e) => setTrades(e.target.value)}
          maxLength={400}
        />
        {problem ? <Alert tone="danger" title={problem} /> : null}
        {m.create.isError ? (
          <ErrorAlert
            error={m.create.error}
            title={
              isApiError(m.create.error, 409)
                ? 'This company already has an unfinished form on that template.'
                : 'We couldn’t start the form'
            }
          />
        ) : null}
      </form>
    </Dialog>
  );
}
