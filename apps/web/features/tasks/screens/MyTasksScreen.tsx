'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  ToggleGroup,
} from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { NewTaskDialog } from '../components/NewTaskDialog';
import type { MyTask } from '../data/api';
import { isForbidden, useMyTasks, useSetTaskStatus } from '../hooks/useTasks';
import { BUCKET_LABEL, SOURCE_LABEL, groupByBucket, sourceHref } from '../lib/sourceLink';

const BUCKET_TONE = {
  overdue: 'danger',
  today: 'warning',
  week: 'info',
  later: 'neutral',
  none: 'neutral',
} as const;

/** Everything assigned to you across projects: your own tasks plus meeting and incident actions. */
export function MyTasksScreen() {
  const org = useCurrentOrg();
  const [view, setView] = useState<'open' | 'done'>('open');
  const [adding, setAdding] = useState(false);
  const tasks = useMyTasks(view);
  const setStatus = useSetTaskStatus();
  const digest = tasks.data?.digest;
  const groups = groupByBucket(tasks.data?.data ?? []);

  return (
    <div className="stack">
      <PageHeader
        title="My tasks"
        description="Your tasks and the actions assigned to you, across every project."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={20} aria-hidden="true" /> New task
          </Button>
        }
      />
      {isForbidden(tasks.error) ? (
        <EmptyState
          title="Tasks are for the project team"
          description="Your access doesn't include the team's task list."
        />
      ) : (
        <ErrorAlert error={tasks.error} title="We couldn't load your tasks" />
      )}
      {view === 'open' && digest ? (
        <Card title="My day">
          <div className="stack">
            <p className="tasks__summary">{digest.summary}</p>
            <StatGrid
              items={[
                {
                  label: 'Overdue',
                  value: digest.overdue,
                  tone: digest.overdue > 0 ? 'danger' : 'neutral',
                },
                {
                  label: 'Due today',
                  value: digest.dueToday,
                  tone: digest.dueToday > 0 ? 'warning' : 'neutral',
                },
                { label: 'Next 7 days', value: digest.dueThisWeek },
              ]}
            />
          </div>
        </Card>
      ) : null}
      <ToggleGroup
        label="Show"
        value={view}
        onValueChange={setView}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done (30 days)' },
        ]}
      />
      {tasks.isPending ? <SkeletonRows rows={4} label="Loading your tasks…" /> : null}
      {tasks.data && groups.length === 0 ? (
        <EmptyState
          title={view === 'open' ? "You're all caught up" : 'Nothing completed recently'}
          description={
            view === 'open'
              ? 'Tasks and actions assigned to you will show up here.'
              : 'Tasks you finish in the next 30 days will be listed here.'
          }
        />
      ) : null}
      {groups.map((g) => (
        <section key={g.bucket} className="tasks__group" aria-label={BUCKET_LABEL[g.bucket]}>
          <h2 className="tasks__heading">
            {view === 'open' ? BUCKET_LABEL[g.bucket] : 'Completed'}
            <span className="tasks__count"> · {g.rows.length}</span>
          </h2>
          <ul className="tasks__list">
            {g.rows.map((t) => (
              <TaskRow
                key={t.key}
                task={t}
                orgSlug={org.orgSlug}
                busy={setStatus.isPending && setStatus.variables?.taskId === t.id}
                onToggle={() =>
                  setStatus.mutate({
                    projectId: t.projectId,
                    taskId: t.id,
                    status: t.status === 'open' ? 'done' : 'open',
                  })
                }
              />
            ))}
          </ul>
        </section>
      ))}
      <ErrorAlert error={setStatus.error} title="We couldn't update the task" />
      <NewTaskDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function TaskRow({
  task: t,
  orgSlug,
  busy,
  onToggle,
}: {
  task: MyTask;
  orgSlug: string;
  busy: boolean;
  onToggle: () => void;
}) {
  const href = sourceHref(orgSlug, t);
  const editable = t.source === 'task';
  return (
    <li className="tasks__row" data-done={t.status === 'done' || undefined}>
      {editable ? (
        <input
          type="checkbox"
          className="tasks__check"
          checked={t.status === 'done'}
          disabled={busy}
          onChange={onToggle}
          aria-label={t.status === 'done' ? `Reopen: ${t.title}` : `Mark done: ${t.title}`}
        />
      ) : (
        <span className="tasks__check tasks__check--source" aria-hidden="true" />
      )}
      <div className="tasks__main">
        <p className="tasks__title">
          {href ? (
            <Link className="link" href={href}>
              {t.title}
            </Link>
          ) : (
            t.title
          )}
        </p>
        <p className="tasks__meta">
          {SOURCE_LABEL[t.source]}
          {t.ref ? ` · ${t.ref}` : ''} · {t.projectName}
        </p>
      </div>
      <div className="tasks__side">
        {t.dueDate && t.status === 'open' ? (
          <StatusPill tone={BUCKET_TONE[t.bucket]}>{formatLocalDate(t.dueDate)}</StatusPill>
        ) : t.dueDate ? (
          <span className="u-caption">{formatLocalDate(t.dueDate)}</span>
        ) : null}
      </div>
    </li>
  );
}
