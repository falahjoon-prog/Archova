'use client';

import { useState, type FormEvent } from 'react';
import { Button, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { LiveSource } from '../data/api';
import { useMeetingMutations } from '../hooks/useMeetings';
import { LIVE_SOURCE_LABELS } from '../lib/labels';

const SOURCE_OPTIONS = Object.entries(LIVE_SOURCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Adds an agenda section for notes, or a live list from a register that issuing freezes (MTG-US5, MTG-AC6). */
export function AddSectionForm({ meetingId }: { meetingId: string }) {
  const { addSection } = useMeetingMutations(meetingId);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<LiveSource | ''>('');
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = title.trim() || (source ? LIVE_SOURCE_LABELS[source] : '');
    if (!name) return setProblem('Name the section.');
    setProblem(null);
    addSection.mutate(
      { title: name, ...(source ? { liveSource: source } : {}) },
      {
        onSuccess: () => {
          setTitle('');
          setSource('');
          setOpen(false);
        },
      },
    );
  }

  if (!open)
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Add a section
        </Button>
      </div>
    );
  return (
    <form className="stack minutes-add" onSubmit={submit} noValidate aria-label="Add a section">
      <ErrorAlert error={addSection.error} title="We couldn't add the section" />
      <div className="form-row">
        <Select
          label="List from a register"
          placeholder="None, notes only"
          hint="A live list is read when you open the minutes and frozen when you issue them. It is for the builder only."
          options={SOURCE_OPTIONS}
          value={source}
          onChange={(e) => setSource(e.target.value as LiveSource | '')}
        />
        <TextField
          label="Section title"
          value={title}
          maxLength={200}
          placeholder={source ? LIVE_SOURCE_LABELS[source] : undefined}
          onChange={(e) => setTitle(e.target.value)}
          error={problem ?? undefined}
        />
      </div>
      <div className="form-row">
        <Button type="submit" variant="secondary" loading={addSection.isPending}>
          Add section
        </Button>
        <Button variant="tertiary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
