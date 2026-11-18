'use client';

import Link from 'next/link';
import { TRADE_CATEGORY_LABELS, optionsOf, type TradeCategoryKey } from '@/shared/lib/dbp';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { ChevronLeft, InspectionsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useTemplateMutations, useTemplates } from '../hooks/useInspections';
import {
  RESPONSE_TYPE_LABELS,
  type ResponseType,
  type Template,
  type TemplateInput,
  type TemplateItemInput,
} from '../lib/types';

const RESPONSE_TYPES = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];

/** Checklists (ITPs, pre-pour checks, handover, safety walks): draft, publish, and start a new version. */
export function TemplatesScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const list = useTemplates();
  const m = useTemplateMutations();
  const [adding, setAdding] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'inspections', id: 'checklists' },
  });

  const columns: DataTableColumn<Template>[] = [
    {
      id: 'name',
      header: 'Checklist',
      rowHeader: true,
      sortValue: (t) => t.name,
      cell: (t) => t.name,
    },
    { id: 'type', header: 'Type', cell: (t) => t.type },
    { id: 'version', header: 'Version', sortValue: (t) => t.version, cell: (t) => `v${t.version}` },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => (
        <StatusPill tone={t.published ? 'success' : 'neutral'}>
          {t.published ? 'Published' : 'Draft'}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (t) =>
        t.published ? (
          <Button
            variant="tertiary"
            aria-label={`New version of ${t.name}`}
            disabled={m.newVersion.isPending}
            onClick={() => m.newVersion.mutate(t.id)}
          >
            New version
          </Button>
        ) : (
          <Button
            variant="tertiary"
            aria-label={`Publish ${t.name}`}
            disabled={m.publish.isPending}
            onClick={() => m.publish.mutate(t.id)}
          >
            Publish
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Inspection checklists"
        description="A checklist is frozen once published. Start a new version to change it; inspections already started keep the version they used."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.inspections(org.orgSlug, project.projectId)}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Inspections
            </Link>
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> New checklist
            </Button>
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inspections" /> : null}
      <ErrorAlert
        error={list.error ?? m.publish.error ?? m.newVersion.error}
        title="Something went wrong with checklists"
      />
      {list.isPending ? (
        <SkeletonRows label="Loading checklists…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title="No checklists yet"
          description="Create one, publish it, then start inspections from it."
        />
      ) : (
        <DataTable
          caption="Checklists"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(t) => t.id}
        />
      )}
      {adding ? (
        <NewDialog
          pending={m.create.isPending}
          error={m.create.error}
          onClose={() => setAdding(false)}
          onSave={(input) => m.create.mutate(input, { onSuccess: () => setAdding(false) })}
        />
      ) : null}
    </>
  );
}

function NewDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: TemplateInput) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [tradeCategory, setTradeCategory] = useState('');
  const [items, setItems] = useState<TemplateItemInput[]>([]);
  const [prompt, setPrompt] = useState('');
  const [section, setSection] = useState('');
  const [responseType, setResponseType] = useState<ResponseType>('pass_fail_na');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(true);
  const [defect, setDefect] = useState(false);
  const choices = options
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const itemOk = prompt.trim() !== '' && (responseType !== 'select' || choices.length >= 2);
  return (
    <Dialog
      open
      onClose={onClose}
      title="New checklist"
      description="Add the questions in order. It stays a draft until you publish it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || items.length === 0 || pending}
            onClick={() =>
              onSave({
                name: name.trim(),
                type: type.trim() || undefined,
                tradeCategory: (tradeCategory || undefined) as TradeCategoryKey | undefined,
                items,
              })
            }
          >
            {pending ? 'Saving…' : 'Save draft'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Checklist name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Type"
          value={type}
          hint="For example ITP, pre-pour, handover or safety walk."
          onChange={(e) => setType(e.target.value)}
        />
        <Select
          label="Building element"
          value={tradeCategory}
          placeholder="Not set"
          hint="Groups this checklist's results under DBP Act insights."
          options={optionsOf(TRADE_CATEGORY_LABELS)}
          onChange={(e) => setTradeCategory(e.target.value)}
        />
        {items.length > 0 ? (
          <ol>
            {items.map((it, i) => (
              <li key={`${it.prompt}-${i}`}>
                {it.prompt} · {RESPONSE_TYPE_LABELS[it.responseType]}
                {it.required === false ? ' · optional' : ''}{' '}
                <Button
                  variant="tertiary"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        <fieldset className="stack">
          <legend>Add a question</legend>
          <TextField label="Question" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <TextField label="Section" value={section} onChange={(e) => setSection(e.target.value)} />
          <Select
            label="Answer type"
            value={responseType}
            options={RESPONSE_TYPES.map((r) => ({ value: r, label: RESPONSE_TYPE_LABELS[r] }))}
            onChange={(e) => setResponseType(e.target.value as ResponseType)}
          />
          {responseType === 'select' ? (
            <TextField
              label="Choices"
              value={options}
              hint="Separate with commas. At least two."
              onChange={(e) => setOptions(e.target.value)}
            />
          ) : null}
          <Checkbox
            label="Required"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          {responseType === 'pass_fail_na' ? (
            <Checkbox
              label="A fail can raise a defect"
              checked={defect}
              onChange={(e) => setDefect(e.target.checked)}
            />
          ) : null}
          <Button
            variant="secondary"
            disabled={!itemOk}
            onClick={() => {
              setItems((cur) => [
                ...cur,
                {
                  prompt: prompt.trim(),
                  responseType,
                  ...(section.trim() ? { section: section.trim() } : {}),
                  ...(responseType === 'select' ? { options: choices } : {}),
                  required,
                  ...(responseType === 'pass_fail_na' && defect
                    ? { createsDefectOnFail: true }
                    : {}),
                },
              ]);
              setPrompt('');
              setOptions('');
              setDefect(false);
            }}
          >
            Add question
          </Button>
        </fieldset>
        <ErrorAlert error={error} title="We couldn't save the checklist" />
      </div>
    </Dialog>
  );
}
