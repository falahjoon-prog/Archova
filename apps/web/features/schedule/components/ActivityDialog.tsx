'use client';

import { useState, type FormEvent } from 'react';
import { Button, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import type { DepType, ScheduleActivity, ScheduleDetail } from '../data/programme';
import { useProgrammeMutations } from '../hooks/useProgramme';
import { DEP_LABELS } from '../lib/labels';

const DEP_OPTIONS = Object.entries(DEP_LABELS).map(([value, label]) => ({ value, label }));
const KIND_OPTIONS = [
  { value: 'task', label: 'Task' },
  { value: 'milestone', label: 'Milestone' },
];

/** Adds or edits a task or milestone, and (when editing) the activities it waits for (SCH-US9). */
export function ActivityDialog({
  open,
  onClose,
  detail,
  activity,
  today,
}: {
  open: boolean;
  onClose: () => void;
  detail: ScheduleDetail;
  /** Null to add a new activity. */
  activity: ScheduleActivity | null;
  today: string;
}) {
  const m = useProgrammeMutations(detail.schedule.id);
  const [form, setForm] = useState(() => ({
    name: activity?.name ?? '',
    kind: activity?.kind ?? 'task',
    wbs: activity?.wbs ?? '',
    start: activity?.start ?? today,
    finish: activity?.finish ?? today,
    pctComplete: String(activity?.pctComplete ?? 0),
    assignee: activity?.assignee ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pred, setPred] = useState({ id: '', type: 'FS' as DepType, lag: '0' });
  const save = activity ? m.updateActivity : m.createActivity;
  const server = serverFieldErrors(save.error);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const milestone = form.kind === 'milestone';
  const incoming = activity ? detail.dependencies.filter((d) => d.successorId === activity.id) : [];
  const name = (id: string) =>
    detail.activities.find((a) => a.id === id)?.name ?? 'Unknown activity';
  const others = detail.activities.filter((a) => a.id !== activity?.id);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Name the activity.';
    if (!form.start) next.start = 'Choose a start date.';
    if (!milestone && form.finish < form.start) next.finish = 'Finish must be on or after start.';
    const pct = Number(form.pctComplete);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) next.pctComplete = 'Enter 0 to 100.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      wbs: form.wbs.trim(),
      start: form.start,
      finish: milestone ? form.start : form.finish,
      pctComplete: pct,
      assignee: form.assignee.trim(),
    };
    if (activity)
      m.updateActivity.mutate({ activityId: activity.id, body }, { onSuccess: onClose });
    else m.createActivity.mutate(body, { onSuccess: onClose });
  }

  function addPredecessor() {
    if (!activity || !pred.id) return;
    const lag = Number(pred.lag);
    m.createDependency.mutate(
      {
        predecessorId: pred.id,
        successorId: activity.id,
        type: pred.type,
        lagDays: Number.isInteger(lag) ? lag : 0,
      },
      { onSuccess: () => setPred({ id: '', type: 'FS', lag: '0' }) },
    );
  }

  const err = (k: string) => errors[k] ?? server[k];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={activity ? 'Edit activity' : 'Add activity'}
      description={
        activity
          ? 'Change the dates or progress; float and the critical path update when you save.'
          : 'A task has a start and a finish. A milestone is a single day.'
      }
      footer={
        <>
          {activity ? (
            <Button
              variant="tertiary"
              loading={m.deleteActivity.isPending}
              onClick={() => m.deleteActivity.mutate(activity.id, { onSuccess: onClose })}
            >
              Delete
            </Button>
          ) : null}
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="activity-form" loading={save.isPending}>
            {activity ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="activity-form" className="stack" onSubmit={submit} noValidate>
        <ErrorAlert
          error={save.error ?? m.deleteActivity.error}
          title="We couldn't save the activity"
        />
        <TextField
          label="Name"
          value={form.name}
          maxLength={300}
          onChange={(e) => set('name', e.target.value)}
          error={err('name')}
        />
        <div className="form-row">
          <Select
            label="Type"
            options={KIND_OPTIONS}
            value={form.kind}
            onChange={(e) => set('kind', e.target.value as 'task' | 'milestone')}
          />
          <TextField
            label="WBS"
            hint="Optional, like 1.2.3."
            value={form.wbs}
            maxLength={100}
            onChange={(e) => set('wbs', e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label={milestone ? 'Date' : 'Start'}
            type="date"
            value={form.start}
            onChange={(e) => set('start', e.target.value)}
            error={err('start')}
          />
          {milestone ? null : (
            <TextField
              label="Finish"
              type="date"
              value={form.finish}
              onChange={(e) => set('finish', e.target.value)}
              error={err('finish')}
            />
          )}
        </div>
        <div className="form-row">
          <TextField
            label="Percent complete"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={form.pctComplete}
            onChange={(e) => set('pctComplete', e.target.value)}
            error={err('pctComplete')}
          />
          <TextField
            label="Who does it"
            hint="A company or crew name."
            value={form.assignee}
            maxLength={200}
            onChange={(e) => set('assignee', e.target.value)}
          />
        </div>
      </form>
      {activity ? (
        <section className="stack" aria-label="Waits for">
          <h3 className="u-m-0">Waits for</h3>
          <ErrorAlert
            error={m.createDependency.error ?? m.deleteDependency.error}
            title="We couldn't change the link"
          />
          {incoming.length ? (
            <ul className="activity-links">
              {incoming.map((d) => (
                <li key={d.id} className="activity-links__row">
                  <span>
                    {name(d.predecessorId)}{' '}
                    <span className="u-muted">
                      ({DEP_LABELS[d.type]}
                      {d.lagDays ? `, ${d.lagDays > 0 ? '+' : ''}${d.lagDays}d` : ''})
                    </span>
                    {d.violated ? <span className="u-danger"> · dates break this link</span> : null}
                  </span>
                  <Button
                    variant="tertiary"
                    loading={m.deleteDependency.isPending && m.deleteDependency.variables === d.id}
                    onClick={() => m.deleteDependency.mutate(d.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-muted u-m-0">Nothing yet.</p>
          )}
          {others.length ? (
            <div className="form-row form-row--end">
              <Select
                label="Add a link"
                placeholder="Choose an activity"
                options={others.map((a) => ({ value: a.id, label: a.name }))}
                value={pred.id}
                onChange={(e) => setPred((p) => ({ ...p, id: e.target.value }))}
              />
              <Select
                label="Type"
                options={DEP_OPTIONS}
                value={pred.type}
                onChange={(e) => setPred((p) => ({ ...p, type: e.target.value as DepType }))}
              />
              <TextField
                label="Lag (days)"
                type="number"
                inputMode="numeric"
                value={pred.lag}
                onChange={(e) => setPred((p) => ({ ...p, lag: e.target.value }))}
              />
              <Button
                variant="secondary"
                disabled={!pred.id}
                loading={m.createDependency.isPending}
                onClick={addPredecessor}
              >
                Add link
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </Dialog>
  );
}
