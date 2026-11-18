'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { CoordinationIssueDetail, CoordinationIssuePriority } from '../data/api';
import { useBimModels, useCoordinationMutations } from '../hooks/useCoordination';
import { PRIORITY_LABEL, parseGuids } from '../lib/issues';

export interface IssuePin {
  drawingRevisionId: string;
  /** 0..1 across the sheet, origin top-left. */
  x: number;
  y: number;
}

const PRIORITIES = Object.keys(PRIORITY_LABEL) as CoordinationIssuePriority[];

/**
 * Raise a coordination issue. From the register it asks for the model and element ids; from a point on a drawing the
 * caller passes `pin`, a `snapshot` of the sheet area and `pinLabel` (such as "A-101 Level 3"), and the issue is
 * raised there with that picture.
 */
export function CreateIssueDialog({
  open,
  onClose,
  onCreated,
  pin,
  snapshot,
  pinLabel,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (created: CoordinationIssueDetail) => void;
  pin?: IssuePin;
  snapshot?: Blob | null;
  pinLabel?: string;
}) {
  const dir = useProjectDirectory();
  const models = useBimModels();
  const m = useCoordinationMutations();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CoordinationIssuePriority>('medium');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [location, setLocation] = useState('');
  const [modelId, setModelId] = useState('');
  const [guids, setGuids] = useState('');

  const previewUrl = useMemo(() => (snapshot ? URL.createObjectURL(snapshot) : null), [snapshot]);
  useEffect(() => () => (previewUrl ? URL.revokeObjectURL(previewUrl) : undefined), [previewUrl]);
  const currentModels = (models.data ?? []).filter((x) => x.status === 'current');

  const submit = () =>
    m.raise.mutate(
      {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
        ...(assignee ? { assigneeId: assignee } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(pin ? { pin } : {}),
        ...(snapshot ? { snapshot } : {}),
        ...(!pin && modelId ? { modelId } : {}),
        ...(!pin && parseGuids(guids).length ? { elementGuids: parseGuids(guids) } : {}),
      },
      {
        onSuccess: (created) => {
          setTitle('');
          setDescription('');
          setLocation('');
          setDueDate('');
          onClose();
          onCreated?.(created);
        },
      },
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Raise a coordination issue"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || m.raise.isPending} onClick={submit}>
            {m.raise.isPending ? 'Raising…' : 'Raise issue'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {pin ? (
          <figure className="u-m-0">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob: the drawing area just picked
              <img
                src={previewUrl}
                alt={`Drawing snapshot${pinLabel ? ` of ${pinLabel}` : ''}`}
                style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)' }}
              />
            ) : null}
            <figcaption className="u-caption">
              Pinned on {pinLabel ?? 'the drawing'} at {Math.round(pin.x * 100)}% across,{' '}
              {Math.round(pin.y * 100)}% down.
            </figcaption>
          </figure>
        ) : null}
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          label="Description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextField
          label="Location"
          placeholder="Level 2, grid C4"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <Select
          label="Assign to"
          value={assignee}
          options={[
            { value: '', label: 'Not assigned' },
            ...dir.people.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(e) => setAssignee(e.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <Select
          label="Priority"
          value={priority}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          onChange={(e) => setPriority(e.target.value as CoordinationIssuePriority)}
        />
        {pin ? null : (
          <>
            <Select
              label="Model"
              value={modelId}
              options={[
                { value: '', label: 'Not set' },
                ...currentModels.map((x) => ({ value: x.id, label: x.name })),
              ]}
              onChange={(e) => setModelId(e.target.value)}
            />
            <Textarea
              label="Element ids"
              hint="IFC GlobalIds, separated by spaces, commas or new lines"
              rows={2}
              value={guids}
              onChange={(e) => setGuids(e.target.value)}
            />
          </>
        )}
        <ErrorAlert error={m.raise.error} title="We couldn't raise the issue" />
      </div>
    </Dialog>
  );
}
