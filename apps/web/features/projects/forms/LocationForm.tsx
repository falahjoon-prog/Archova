'use client';

import { useState, type FormEvent } from 'react';
import { LOCATION_KINDS } from '@archova/domain';
import { Button, Checkbox, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import type { ProjectLocation } from '../data/locations';
import { useLocationMutations } from '../hooks/useLocations';
import { KIND_LABELS, draftOf, emptyDraft, toBody, type LocationDraft } from '../lib/locations';

/** Pins a new location, or edits one. The first location a project adds becomes its default. */
export function LocationForm({
  projectId,
  location,
  onDone,
}: {
  projectId: string;
  location?: ProjectLocation;
  onDone: () => void;
}) {
  const { create, update } = useLocationMutations(projectId);
  const save = location ? update : create;
  const [d, setD] = useState<LocationDraft>(() => (location ? draftOf(location) : emptyDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) =>
    setD((x) => ({ ...x, [key]: value }));
  const server = serverFieldErrors(save.error);
  const err = (k: string) => errors[k] ?? server[k];

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!d.name.trim()) next.name = 'Give the location a name.';
    if (!d.address.trim() && !location?.point) next.address = 'Enter the address.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = toBody(d);
    if (location)
      update.mutate({ id: location.id, version: location.version, body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label="Location">
      <ErrorAlert error={save.error} title="We couldn't save the location" />
      <div className="form-row">
        <TextField
          label="Name"
          placeholder="Main site office"
          value={d.name}
          maxLength={120}
          onChange={(e) => set('name', e.target.value)}
          error={err('name')}
        />
        <Select
          label="Type"
          options={LOCATION_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          value={d.kind}
          onChange={(e) => set('kind', e.target.value as LocationDraft['kind'])}
        />
      </div>
      <TextField
        label="Address"
        hint="Get Directions opens this in the maps app on the person's phone."
        value={d.address}
        maxLength={300}
        onChange={(e) => set('address', e.target.value)}
        error={err('address')}
      />
      <Textarea
        label="Site access note"
        hint="Gate code, parking instructions, what to do on arrival."
        rows={3}
        value={d.accessNote}
        maxLength={2000}
        onChange={(e) => set('accessNote', e.target.value)}
        error={err('accessNote')}
      />
      <div className="form-row">
        <TextField
          label="Site contact (optional)"
          value={d.contactName}
          maxLength={120}
          onChange={(e) => set('contactName', e.target.value)}
        />
        <TextField
          label="Contact phone (optional)"
          type="tel"
          value={d.contactPhone}
          maxLength={40}
          onChange={(e) => set('contactPhone', e.target.value)}
        />
      </div>
      <TextField
        label="Used for (optional)"
        hint="Words like deliveries, visitors, workers. Nova uses them to suggest this point to the right people."
        value={d.usedFor}
        onChange={(e) => set('usedFor', e.target.value)}
        error={err('usedFor')}
      />
      <Checkbox
        label="Default access point"
        hint="What Nova offers when nothing more specific fits."
        checked={d.isDefault}
        onChange={(e) => set('isDefault', e.target.checked)}
      />
      <div className="row-actions">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save location'}
        </Button>
      </div>
    </form>
  );
}
