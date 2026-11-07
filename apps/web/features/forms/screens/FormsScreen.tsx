'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
} from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { AttentionBanner } from '../components/AttentionBanner';
import { useFormAttention, useForms, useProjectTemplates, useStartForm } from '../hooks/useForms';
import { CATEGORY_LABELS, LINK_LABELS, groupBy } from '../lib/fields';

/** Forms grouped by template, plus the template library to start a new one from. */
export function FormsScreen() {
  const project = useCurrentProject();
  const { orgSlug } = useCurrentOrg();
  const router = useRouter();
  usePublishAssistantScope({ projectId: project.projectId });
  const forms = useForms(project.projectId);
  const templates = useProjectTemplates(project.projectId);
  const attention = useFormAttention(project.projectId);
  const start = useStartForm(project.projectId);
  const [tab, setTab] = useState('forms');
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const begin = (templateId: string) =>
    start.mutate(templateId, {
      onSuccess: (d) => router.push(webRoutes.form(orgSlug, project.projectId, d.form.id)),
    });

  const groups = groupBy(forms.data ?? [], (f) => f.templateName).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const matching = (templates.data ?? []).filter((t) =>
    `${t.name} ${t.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Forms"
        description="Job hazard analyses, toolbox talks, permits and your own forms."
        actions={
          <Button onClick={() => setPicking(true)}>
            <Plus size={20} aria-hidden="true" /> New form
          </Button>
        }
      />
      <AttentionBanner flags={attention.data ?? []} />
      <ErrorAlert error={start.error} title="We couldn't start the form" />
      <Tabs
        label="Forms views"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'forms', label: 'Forms' },
          { id: 'templates', label: 'Form templates' },
        ]}
      >
        {tab === 'forms' ? (
          <>
            <ErrorAlert error={forms.error} title="We couldn't load the forms" />
            {forms.isPending ? <SkeletonRows rows={4} label="Loading forms…" /> : null}
            {forms.data && groups.length === 0 ? (
              <EmptyState
                title="No forms yet"
                description="Start one from a template, such as a Job Hazard Analysis or a Toolbox Talk."
              />
            ) : null}
            {groups.map(([name, items]) => (
              <section key={name} className="forms__section" aria-label={name}>
                <h2 className="forms__section-title">
                  {name} <span className="u-caption">({items.length})</span>
                </h2>
                <ul className="forms__list">
                  {items.map((f) => (
                    <li key={f.id}>
                      <Link
                        className="forms__item"
                        href={webRoutes.form(orgSlug, project.projectId, f.id)}
                      >
                        <span className="forms__item-main">
                          <span className="forms__item-title">{f.title}</span>
                          <span className="u-caption">
                            {f.numberLabel} · Created by {f.createdByName} ·{' '}
                            {formatInstant(f.createdAt, project.timezone)}
                          </span>
                        </span>
                        <StatusPill tone={f.status === 'submitted' ? 'success' : 'neutral'}>
                          {f.status === 'submitted' ? 'Submitted' : 'Draft'}
                        </StatusPill>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        ) : (
          <TemplateList
            query={query}
            onQuery={setQuery}
            loading={templates.isPending}
            error={templates.error}
            templates={matching}
            onStart={begin}
            starting={start.isPending}
          />
        )}
      </Tabs>
      <Dialog open={picking} onClose={() => setPicking(false)} title="Start a form">
        <TemplateList
          query={query}
          onQuery={setQuery}
          loading={templates.isPending}
          error={templates.error}
          templates={matching}
          onStart={(id) => {
            setPicking(false);
            begin(id);
          }}
          starting={start.isPending}
        />
      </Dialog>
    </>
  );
}

function TemplateList({
  query,
  onQuery,
  loading,
  error,
  templates,
  onStart,
  starting,
}: {
  query: string;
  onQuery: (q: string) => void;
  loading: boolean;
  error: unknown;
  templates: readonly {
    id: string;
    name: string;
    description: string;
    category: keyof typeof CATEGORY_LABELS;
    source: 'library' | 'custom';
    linkModule: keyof typeof LINK_LABELS | null;
  }[];
  onStart: (id: string) => void;
  starting: boolean;
}) {
  return (
    <div className="stack">
      <TextField
        label="Search templates"
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Hot work, toolbox…"
      />
      <ErrorAlert error={error} title="We couldn't load the templates" />
      {loading ? <SkeletonRows rows={4} label="Loading templates…" /> : null}
      {!loading && templates.length === 0 ? (
        <EmptyState title="No templates match" description="Try another word." />
      ) : null}
      <ul className="forms__list">
        {templates.map((t) => (
          <li key={t.id} className="forms__template">
            <span className="forms__item-main">
              <span className="forms__item-title">{t.name}</span>
              <span className="u-caption">
                {CATEGORY_LABELS[t.category]}
                {t.source === 'custom' ? ' · Your template' : ''}
                {t.linkModule ? ` · Goes with ${LINK_LABELS[t.linkModule]}` : ''}
              </span>
              {t.description ? <span>{t.description}</span> : null}
            </span>
            <Button variant="secondary" loading={starting} onClick={() => onStart(t.id)}>
              Start
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
