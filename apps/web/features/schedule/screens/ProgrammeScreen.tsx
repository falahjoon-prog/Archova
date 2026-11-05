'use client';

import { useMemo, useState } from 'react';
import { atLeast } from '@archova/domain/permissions';
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
  ToggleGroup,
} from '@archova/ui';
import { Plus, ProgrammeIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { ActivityDialog } from '../components/ActivityDialog';
import { GanttChart } from '../components/GanttChart';
import { ImportProgrammeDialog } from '../components/ImportProgrammeDialog';
import { LookaheadView } from '../components/LookaheadView';
import type { ScheduleActivity } from '../data/programme';
import {
  useProgrammeMutations,
  useSchedule,
  useScheduleLinks,
  useSchedules,
} from '../hooks/useProgramme';
import { openItemsByActivity } from '../lib/links';
import { SOURCE_NAMES } from '../lib/labels';
import type { Zoom } from '../lib/gantt';

const ZOOM_OPTIONS = [
  { value: 'day' as const, label: 'Days' },
  { value: 'week' as const, label: 'Weeks' },
  { value: 'month' as const, label: 'Months' },
];

/** The project programme: Gantt chart with dependencies and critical path, and the look-ahead (product/08 S4, S5). */
export function ProgrammeScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'programme', id: 'list' },
  });
  const permissions = useProjectPermissions(org.orgId, project.projectId);
  const canWrite = permissions.data
    ? atLeast(permissions.data.toolLevels.schedule, 'standard')
    : false;
  const canImport = permissions.data
    ? atLeast(permissions.data.toolLevels.schedule, 'admin')
    : false;

  const schedules = useSchedules();
  const [chosen, setChosen] = useState<string | null>(null);
  const scheduleId = chosen ?? schedules.data?.[0]?.id ?? null;
  const detail = useSchedule(scheduleId);
  const m = useProgrammeMutations(scheduleId);
  const [tab, setTab] = useState('gantt');
  const [zoom, setZoom] = useState<Zoom>('week');
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<ScheduleActivity | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const today = todayIn(project.timezone);
  const d = detail.data;
  const links = useScheduleLinks(d ? d.schedule.id : null);
  const openItems = useMemo(
    () =>
      openItemsByActivity(
        links.data ?? [],
        new Map((d?.activities ?? []).map((a) => [a.id, a.start])),
        today,
      ),
    [links.data, d, today],
  );

  const open = (id: string) => {
    const a = d?.activities.find((x) => x.id === id);
    if (a && canWrite) setEditing(a);
  };

  return (
    <div className="stack">
      <PageHeader
        title="Programme"
        description="Tasks, milestones and the logic between them, with the critical path and a look-ahead for the trades."
        actions={
          <>
            {canImport ? (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                Import MS Project / P6
              </Button>
            ) : null}
            {canWrite ? (
              <Button onClick={() => setNewName('')}>
                <Plus size={16} aria-hidden="true" /> New programme
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={schedules.error ?? detail.error} title="We couldn't load the programme" />
      {schedules.isPending ? <SkeletonRows rows={5} label="Loading programme…" /> : null}
      {schedules.data && !schedules.data.length ? (
        <EmptyState
          icon={ProgrammeIcon}
          title="No programme yet"
          description="Import the master programme from MS Project or Primavera P6, or start one here."
          action={
            canWrite || canImport ? (
              <div className="row-actions">
                {canImport ? (
                  <Button onClick={() => setImporting(true)}>Import a file</Button>
                ) : null}
                {canWrite ? (
                  <Button variant="secondary" onClick={() => setNewName('')}>
                    Start an empty programme
                  </Button>
                ) : null}
              </div>
            ) : undefined
          }
        />
      ) : null}

      {schedules.data?.length && scheduleId ? (
        <>
          <div className="programme-bar">
            <Select
              label="Revision"
              options={schedules.data.map((s) => ({
                value: s.id,
                label: `${s.name} (${SOURCE_NAMES[s.source]})`,
              }))}
              value={scheduleId}
              onChange={(e) => setChosen(e.target.value)}
            />
            {d ? (
              <div className="programme-bar__facts">
                <StatusPill tone="neutral">{d.schedule.activityCount} activities</StatusPill>
                {d.schedule.startDate && d.schedule.finishDate ? (
                  <StatusPill tone="info">
                    {formatLocalDate(d.schedule.startDate)} to{' '}
                    {formatLocalDate(d.schedule.finishDate)}
                  </StatusPill>
                ) : null}
                {d.criticalCount ? (
                  <StatusPill tone="warning">{d.criticalCount} critical</StatusPill>
                ) : null}
                {d.violationCount ? (
                  <StatusPill tone="danger">
                    {d.violationCount} broken {d.violationCount === 1 ? 'link' : 'links'}
                  </StatusPill>
                ) : null}
              </div>
            ) : null}
          </div>

          <Tabs
            label="Programme views"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { id: 'gantt', label: 'Gantt' },
              { id: 'lookahead', label: 'Look-ahead' },
            ]}
          >
            {tab === 'gantt' ? (
              <div className="stack">
                <div className="programme-bar">
                  <ToggleGroup
                    label="Zoom"
                    value={zoom}
                    options={ZOOM_OPTIONS}
                    onValueChange={setZoom}
                  />
                  <div className="row-actions">
                    {canWrite ? (
                      <Button variant="secondary" onClick={() => setEditing('new')}>
                        <Plus size={16} aria-hidden="true" /> Add activity
                      </Button>
                    ) : null}
                    {canImport ? (
                      <Button variant="tertiary" onClick={() => setConfirmDelete(true)}>
                        Delete revision
                      </Button>
                    ) : null}
                  </div>
                </div>
                {detail.isPending ? <SkeletonRows rows={6} label="Loading programme…" /> : null}
                {d && !d.activities.length ? (
                  <EmptyState
                    title="This programme has no activities"
                    description="Add the first task or milestone."
                    action={
                      canWrite ? (
                        <Button onClick={() => setEditing('new')}>Add activity</Button>
                      ) : undefined
                    }
                  />
                ) : null}
                {d?.activities.length ? (
                  <GanttChart
                    detail={d}
                    today={today}
                    zoom={zoom}
                    openItems={openItems}
                    {...(canWrite ? { onSelect: setEditing } : {})}
                  />
                ) : null}
              </div>
            ) : (
              <LookaheadView scheduleId={scheduleId} {...(canWrite ? { onOpen: open } : {})} />
            )}
          </Tabs>
        </>
      ) : null}

      {editing && d ? (
        <ActivityDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onClose={() => setEditing(null)}
          detail={d}
          activity={
            editing === 'new' ? null : (d.activities.find((a) => a.id === editing.id) ?? editing)
          }
          today={today}
        />
      ) : null}
      <ImportProgrammeDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={setChosen}
      />

      <Dialog
        open={newName !== null}
        onClose={() => setNewName(null)}
        title="New programme"
        description="Starts empty. You can add activities and links, or import a file as another revision."
        footer={
          <>
            <Button variant="tertiary" onClick={() => setNewName(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-programme-form"
              loading={m.create.isPending}
              disabled={!newName?.trim()}
            >
              Create
            </Button>
          </>
        }
      >
        <form
          id="new-programme-form"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName?.trim()) return;
            m.create.mutate(newName.trim(), {
              onSuccess: (r) => {
                setChosen(r.schedule.id);
                setNewName(null);
              },
            });
          }}
        >
          <ErrorAlert error={m.create.error} title="We couldn't create the programme" />
          <TextField
            label="Name"
            value={newName ?? ''}
            maxLength={200}
            placeholder="Master programme"
            onChange={(e) => setNewName(e.target.value)}
          />
        </form>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this revision?"
        description="The activities and links in it are removed. Other revisions are not affected."
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              loading={m.remove.isPending}
              onClick={() =>
                scheduleId &&
                m.remove.mutate(scheduleId, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    setChosen(null);
                  },
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <ErrorAlert error={m.remove.error} title="We couldn't delete it" />
      </Dialog>
    </div>
  );
}
