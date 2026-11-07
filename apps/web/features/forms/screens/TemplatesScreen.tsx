'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCreateTemplate, useOrgTemplates, useUpdateTemplate } from '../hooks/useForms';
import { CATEGORY_LABELS } from '../lib/fields';

/** The organisation's form templates: build your own or copy a built-in one and change it. */
export function TemplatesScreen() {
  const { orgSlug } = useCurrentOrg();
  const router = useRouter();
  const list = useOrgTemplates();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');

  const library = (list.data ?? []).filter((t) => t.source === 'library');
  const custom = (list.data ?? []).filter((t) => t.source === 'custom');

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        ...(from ? { copyFromLibraryKey: from } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
      },
      {
        onSuccess: (t) => router.push(webRoutes.formTemplate(orgSlug, t.id)),
      },
    );
  }

  return (
    <>
      <PageHeader
        title="Form templates"
        description="Build the forms your crews fill in. Forms already started keep the fields they were started with."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={20} aria-hidden="true" /> New template
          </Button>
        }
      />
      <ErrorAlert error={list.error} title="We couldn't load the templates" />
      <ErrorAlert error={update.error} title="We couldn't change the template" />
      {list.isPending ? <SkeletonRows rows={4} label="Loading templates…" /> : null}
      {list.data && custom.length === 0 ? (
        <EmptyState
          title="No templates of your own yet"
          description="Start from a built-in template such as Job Hazard Analysis, or build one from scratch."
        />
      ) : null}
      <ul className="forms__list">
        {custom.map((t) => (
          <li key={t.id} className="forms__template">
            <span className="forms__item-main">
              <Link className="forms__item-title" href={webRoutes.formTemplate(orgSlug, t.id)}>
                {t.name}
              </Link>
              <span className="u-caption">
                {CATEGORY_LABELS[t.category]} · {t.fields.length} fields
              </span>
            </span>
            {t.status === 'archived' ? <StatusPill tone="neutral">Archived</StatusPill> : null}
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  id: t.id,
                  version: t.version,
                  patch: { status: t.status === 'archived' ? 'active' : 'archived' },
                })
              }
            >
              {t.status === 'archived' ? 'Restore' : 'Archive'}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={open} onClose={() => setOpen(false)} title="New template">
        <form className="stack" onSubmit={submit}>
          <ErrorAlert error={create.error} title="We couldn't create the template" />
          <Select
            label="Start from"
            value={from}
            placeholder="A blank template"
            options={library.map((t) => ({ value: t.id.replace('library:', ''), label: t.name }))}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label="Name"
            value={name}
            maxLength={200}
            required={!from}
            hint={from ? 'Leave blank to keep the built-in name.' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="row-actions">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!from && !name.trim()}>
              Create and edit
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
