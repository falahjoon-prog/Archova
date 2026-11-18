'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@archova/ui';
import { NovaIcon, Plus, ToolboxIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useSuggestions, useTalkList, useToolboxMutations, useTopics } from '../hooks/useToolbox';
import { CATEGORY_LABELS, REASON_LABELS, STATUS_LABELS, type Talk, type Topic } from '../lib/types';
import { ToolboxDetailView } from './ToolboxDetailView';
import { NewTalkDialog, TopicDialog } from './dialogs';

/** Toolbox talks. `?id=` opens one talk with its attendance grid; `?view=topics` is the topic library. */
export function ToolboxScreen() {
  const [params, setParams] = useUrlState(['id', 'view'] as const);
  return params.id ? (
    <ToolboxDetailView id={params.id} />
  ) : (
    <ToolboxHome
      view={params.view === 'topics' ? 'topics' : 'talks'}
      setView={(v) => setParams({ view: v === 'talks' ? null : v })}
    />
  );
}

function ToolboxHome({
  view,
  setView,
}: {
  view: 'talks' | 'topics';
  setView: (v: 'talks' | 'topics') => void;
}) {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const talks = useTalkList();
  const topics = useTopics();
  const m = useToolboxMutations();
  const [creating, setCreating] = useState<{ topicId?: string } | null>(null);
  const [addingTopic, setAddingTopic] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'toolbox', id: 'register' },
  });

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Toolbox talks"
        description="Record the talks you hold on site, who attended and their signatures. Nova suggests what to cover next."
        actions={
          view === 'talks' ? (
            <Button onClick={() => setCreating({})}>
              <Plus size={16} aria-hidden="true" /> New talk
            </Button>
          ) : (
            <Button onClick={() => setAddingTopic(true)}>
              <Plus size={16} aria-hidden="true" /> Add topic
            </Button>
          )
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Toolbox talks" /> : null}
      <Tabs
        label="Toolbox talks views"
        tabs={[
          { id: 'talks', label: 'Talks', count: talks.data?.length },
          { id: 'topics', label: 'Topics', count: topics.data?.length },
        ]}
        value={view}
        onValueChange={(v) => setView(v as 'talks' | 'topics')}
      >
        {view === 'talks' ? (
          <TalksPanel talks={talks} onStart={(topicId) => setCreating({ topicId })} />
        ) : (
          <TopicsPanel
            topics={topics}
            onToggle={(topic, isActive) => m.setTopicActive.mutate({ topic, isActive })}
            error={m.setTopicActive.error}
          />
        )}
      </Tabs>
      {creating ? (
        <NewTalkDialog
          topics={topics.data ?? []}
          companies={dir.companies.map((c) => ({ id: c.id, name: c.name }))}
          presenter=""
          timeZone={project.timezone}
          initialTopicId={creating.topicId}
          pending={m.createTalk.isPending}
          error={m.createTalk.error}
          onClose={() => setCreating(null)}
          onSave={(input) => m.createTalk.mutate(input, { onSuccess: () => setCreating(null) })}
        />
      ) : null}
      {addingTopic ? (
        <TopicDialog
          pending={m.createTopic.isPending}
          error={m.createTopic.error}
          onClose={() => setAddingTopic(false)}
          onSave={(input) =>
            m.createTopic.mutate(input, { onSuccess: () => setAddingTopic(false) })
          }
        />
      ) : null}
    </>
  );
}

function TalksPanel({
  talks,
  onStart,
}: {
  talks: ReturnType<typeof useTalkList>;
  onStart: (topicId: string | undefined) => void;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const columns: DataTableColumn<Talk>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (t) => t.numberLabel,
      cell: (t) => (
        <Link
          href={webRoutes.toolboxTalks(org.orgSlug, project.projectId, t.id)}
          aria-label={`${t.numberLabel} ${t.title}`}
        >
          {t.numberLabel}
        </Link>
      ),
    },
    { id: 'title', header: 'Talk', sortValue: (t) => t.title, cell: (t) => t.title },
    {
      id: 'held',
      header: 'When',
      sortValue: (t) => t.heldAt,
      cell: (t) => formatInstant(t.heldAt, project.timezone),
    },
    {
      id: 'by',
      header: 'Presented by',
      sortValue: (t) => t.presenterName,
      cell: (t) => t.presenterName,
    },
    {
      id: 'signed',
      header: 'Signed',
      sortValue: (t) => t.signedCount,
      cell: (t) => `${t.signedCount} of ${t.attendeeCount}`,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (t) => t.status,
      cell: (t) => (
        <StatusPill tone={t.status === 'closed' ? 'success' : 'info'}>
          {STATUS_LABELS[t.status]}
        </StatusPill>
      ),
    },
  ];
  return (
    <div className="stack">
      <Suggestions onStart={onStart} />
      <ErrorAlert error={talks.error} title="We couldn't load toolbox talks" />
      {talks.isPending ? (
        <SkeletonRows label="Loading toolbox talks…" />
      ) : (talks.data ?? []).length === 0 ? (
        <EmptyState
          icon={ToolboxIcon}
          title="No toolbox talks yet"
          description="Record the first one once you have held it. Everyone who attended signs on the grid."
        />
      ) : (
        <DataTable
          caption="Toolbox talks"
          columns={columns}
          rows={talks.data ?? []}
          getRowId={(t) => t.id}
        />
      )}
    </div>
  );
}

function Suggestions({ onStart }: { onStart: (topicId: string | undefined) => void }) {
  const s = useSuggestions();
  const rows = s.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card title="Nova suggests">
      <p
        className="u-m-0"
        style={{ marginBottom: 'var(--space-3)', color: 'var(--c-text-secondary)' }}
      >
        <NovaIcon size={14} aria-hidden="true" /> Suggestions come from rules over this project
        (recent incidents, SWMS in force, topics not run lately). Nothing is created until you start
        a talk.
      </p>
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li
            key={`${r.reason}-${r.title}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ flex: '1 1 16rem', minWidth: 0 }}>
              <strong>{r.title}</strong>{' '}
              <StatusPill tone="neutral">{REASON_LABELS[r.reason]}</StatusPill>
              <br />
              <span style={{ color: 'var(--c-text-secondary)' }}>{r.because}</span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={r.topicId === null}
              onClick={() => onStart(r.topicId ?? undefined)}
            >
              {r.topicId ? 'Start this talk' : 'Add a topic first'}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TopicsPanel({
  topics,
  onToggle,
  error,
}: {
  topics: ReturnType<typeof useTopics>;
  onToggle: (t: Topic, isActive: boolean) => void;
  error: unknown;
}) {
  const project = useCurrentProject();
  const columns: DataTableColumn<Topic>[] = [
    {
      id: 'title',
      header: 'Topic',
      rowHeader: true,
      sortValue: (t) => t.title,
      cell: (t) => t.title,
    },
    {
      id: 'category',
      header: 'Category',
      sortValue: (t) => t.category,
      cell: (t) => CATEGORY_LABELS[t.category],
    },
    {
      id: 'last',
      header: 'Last run',
      sortValue: (t) => t.lastHeldAt ?? '',
      cell: (t) => (t.lastHeldAt ? formatInstant(t.lastHeldAt, project.timezone) : 'Not yet'),
    },
    {
      id: 'active',
      header: 'In use',
      cell: (t) => (
        <Button variant="secondary" size="sm" onClick={() => onToggle(t, !t.isActive)}>
          {t.isActive ? 'Retire' : 'Restore'}
        </Button>
      ),
    },
  ];
  return (
    <div className="stack">
      <ErrorAlert error={topics.error ?? error} title="We couldn't load topics" />
      {topics.isPending ? (
        <SkeletonRows label="Loading topics…" />
      ) : (topics.data ?? []).length === 0 ? (
        <EmptyState
          icon={ToolboxIcon}
          title="No topics yet"
          description="Add the subjects you cover on site. Nova then suggests which one is due."
        />
      ) : (
        <DataTable
          caption="Toolbox topics"
          columns={columns}
          rows={topics.data ?? []}
          getRowId={(t) => t.id}
        />
      )}
    </div>
  );
}
