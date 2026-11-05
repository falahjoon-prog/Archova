'use client';

import { useState, type FormEvent } from 'react';
import { Button, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import type { MeetingSeries, MeetingTemplate } from '../data/api';
import { useMeetingMutations } from '../hooks/useMeetings';
import { defaultHeldAt, localInputToIso, TEMPLATE_LABELS } from '../lib/labels';

const TEMPLATE_OPTIONS = Object.entries(TEMPLATE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** MTG-US1: a series with the agenda its template suggests. People and sections are edited on the first meeting. */
export function NewSeriesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createSeries } = useMeetingMutations(null);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<MeetingTemplate>('site_coordination');
  const [cadence, setCadence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const server = serverFieldErrors(createSeries.error);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Name the series, like “Weekly site meeting”.');
    setError(null);
    createSeries.mutate(
      { name: name.trim(), template, ...(cadence.trim() ? { cadence: cadence.trim() } : {}) },
      {
        onSuccess: () => {
          setName('');
          setCadence('');
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New meeting series"
      description="Each meeting in a series starts from the last one, with its open actions."
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-series-form" loading={createSeries.isPending}>
            Create series
          </Button>
        </>
      }
    >
      <form id="new-series-form" className="stack" onSubmit={submit} noValidate>
        <ErrorAlert error={createSeries.error} title="We couldn't create the series" />
        <TextField
          label="Name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          error={error ?? server.name}
        />
        <Select
          label="Agenda template"
          options={TEMPLATE_OPTIONS}
          value={template}
          onChange={(e) => setTemplate(e.target.value as MeetingTemplate)}
        />
        <TextField
          label="How often"
          hint="Optional, like Weekly or Monthly."
          value={cadence}
          maxLength={100}
          onChange={(e) => setCadence(e.target.value)}
        />
      </form>
    </Dialog>
  );
}

/** Starts the next meeting of a series: open items from the last one come with it (MTG-AC2). */
export function StartMeetingDialog({
  open,
  onClose,
  series,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  series: readonly MeetingSeries[];
  onStarted: (meetingId: string) => void;
}) {
  const { createMeeting } = useMeetingMutations(null);
  const [seriesId, setSeriesId] = useState(series[0]?.id ?? '');
  const [heldAt, setHeldAt] = useState(defaultHeldAt);
  const [location, setLocation] = useState('');
  const chosen = seriesId || series[0]?.id || '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !heldAt) return;
    createMeeting.mutate(
      {
        seriesId: chosen,
        body: {
          heldAt: localInputToIso(heldAt),
          ...(location.trim() ? { location: location.trim() } : {}),
        },
      },
      {
        onSuccess: (d) => {
          onClose();
          onStarted(d.meeting.id);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start a meeting"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="start-meeting-form" loading={createMeeting.isPending}>
            Start meeting
          </Button>
        </>
      }
    >
      <form id="start-meeting-form" className="stack" onSubmit={submit} noValidate>
        <ErrorAlert error={createMeeting.error} title="We couldn't start the meeting" />
        <Select
          label="Series"
          options={series.map((s) => ({ value: s.id, label: s.name }))}
          value={chosen}
          onChange={(e) => setSeriesId(e.target.value)}
        />
        <TextField
          label="Date and time"
          type="datetime-local"
          value={heldAt}
          onChange={(e) => setHeldAt(e.target.value)}
        />
        <TextField
          label="Where"
          hint="Optional."
          value={location}
          maxLength={300}
          onChange={(e) => setLocation(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
