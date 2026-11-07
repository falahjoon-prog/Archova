'use client';

import { useState } from 'react';
import { Button, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useAssignForm, useMemberNames } from '../hooks/useForms';
import type { FormTemplate } from '../lib/types';

/** Starts a form from a published template and hands it to a project member, optionally with a due date. */
export function AssignDialog({
  templates,
  onClose,
  onAssigned,
}: {
  templates: FormTemplate[];
  onClose: () => void;
  onAssigned: (submissionId: string) => void;
}) {
  const members = useMemberNames();
  const assign = useAssignForm();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [title, setTitle] = useState('');

  return (
    <Dialog
      open
      onClose={onClose}
      title="Assign a form"
      description="The person you choose is told, and can fill it in on site."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!templateId || assign.isPending}
            onClick={() =>
              assign.mutate(
                {
                  templateId,
                  ...(title.trim() ? { title: title.trim() } : {}),
                  ...(assigneeId ? { assigneeId } : {}),
                  ...(dueDate ? { dueDate } : {}),
                },
                { onSuccess: (d) => onAssigned(d.submission.id) },
              )
            }
          >
            {assign.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Form"
          value={templateId}
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(e) => setTemplateId(e.target.value)}
        />
        <Select
          label="Assign to"
          value={assigneeId}
          placeholder="Me"
          options={(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
          onChange={(e) => setAssigneeId(e.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <TextField
          label="Title"
          value={title}
          maxLength={200}
          hint="Optional. Defaults to the form name and number."
          onChange={(e) => setTitle(e.target.value)}
        />
        <ErrorAlert error={assign.error} title="We couldn't assign the form" />
      </div>
    </Dialog>
  );
}
