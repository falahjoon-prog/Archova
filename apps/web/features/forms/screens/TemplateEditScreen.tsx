'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
  TextField,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { TemplateBuilder } from '../components/TemplateBuilder';
import type { FormField, FormTemplate } from '../data/api';
import { useOrgTemplates, useUpdateTemplate } from '../hooks/useForms';
import { CATEGORY_LABELS, LINK_LABELS } from '../lib/fields';

export function TemplateEditScreen({ templateId }: { templateId: string }) {
  const list = useOrgTemplates();
  const template = list.data?.find((t) => t.id === templateId);
  return (
    <>
      <ErrorAlert error={list.error} title="We couldn't load the template" />
      {list.isPending ? <SkeletonRows rows={5} label="Loading template…" /> : null}
      {list.data && !template ? (
        <EmptyState
          title="Template not found"
          description="It may belong to another organisation."
        />
      ) : null}
      {template ? <Editor key={`${template.id}:${template.version}`} template={template} /> : null}
    </>
  );
}

function Editor({ template }: { template: FormTemplate }) {
  const { orgSlug } = useCurrentOrg();
  const update = useUpdateTemplate();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [category, setCategory] = useState(template.category);
  const [linkModule, setLinkModule] = useState(template.linkModule ?? '');
  const [cadence, setCadence] = useState(template.cadenceDays ? String(template.cadenceDays) : '');
  const [fields, setFields] = useState<FormField[]>(template.fields);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [name, description, category, linkModule, cadence, fields]);

  function save() {
    update.mutate(
      {
        id: template.id,
        version: template.version,
        patch: {
          name,
          description,
          category,
          fields,
          linkModule: linkModule === '' ? null : (linkModule as keyof typeof LINK_LABELS),
          cadenceDays: cadence === '' ? null : Math.max(1, Math.min(365, Number(cadence) || 1)),
        },
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <>
      <PageHeader
        title={template.name}
        description="Forms already started keep the fields they were started with."
        actions={
          <Button loading={update.isPending} onClick={save}>
            Save template
          </Button>
        }
      />
      <p>
        <Link href={webRoutes.formTemplates(orgSlug)}>All templates</Link>
      </p>
      <ErrorAlert error={update.error} title="We couldn't save the template" />
      {saved ? <Alert tone="success" title="Template saved" /> : null}
      <div className="stack forms__body">
        <TextField
          label="Name"
          value={name}
          maxLength={200}
          error={serverFieldErrors(update.error).name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label="Description"
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Select
          label="Category"
          value={category}
          options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setCategory(e.target.value as FormTemplate['category'])}
        />
        <Select
          label="Goes with"
          hint="Shows a link from each form to that part of the project."
          value={linkModule}
          placeholder="Nothing in particular"
          options={Object.entries(LINK_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setLinkModule(e.target.value as typeof linkModule)}
        />
        <TextField
          label="Expected every (days)"
          hint="Nova flags it when the crew has been on site this long with none submitted. Leave blank for no reminder."
          type="number"
          min={1}
          max={365}
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
        />
        <h2>Fields</h2>
        <TemplateBuilder
          fields={fields}
          onChange={setFields}
          errors={serverFieldErrors(update.error)}
        />
      </div>
    </>
  );
}
