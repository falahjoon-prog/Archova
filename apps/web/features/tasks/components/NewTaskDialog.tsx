'use client';

import { useState, type FormEvent } from 'react';
import { Button, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useProjects } from '@/features/projects';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useAddTask } from '../hooks/useTasks';
import type { TaskPriority } from '../data/api';

const TITLE_MAX = 200;
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

/** Adds a task for yourself on one of your projects. Assigning to others is done from the project. */
export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const org = useCurrentOrg();
  const projects = useProjects(org.orgId);
  const add = useAddTask();
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const options = (projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const ready = title.trim().length > 0 && projectId !== '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    add.mutate(
      {
        projectId,
        title: title.trim(),
        assigneeId: org.user.id,
        priority,
        ...(dueDate ? { dueDate } : {}),
      },
      {
        onSuccess: () => {
          setTitle('');
          setDueDate('');
          setPriority('medium');
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="New task">
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={add.error} title="We couldn't add the task" />
        <TextField
          label="What needs doing?"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Select
          label="Project"
          placeholder="Choose a project"
          options={options}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          required
        />
        <div className="tasks__fields">
          <TextField
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <Select
            label="Priority"
            options={PRIORITIES}
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          />
        </div>
        <div className="row-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready} loading={add.isPending}>
            Add task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
