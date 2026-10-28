'use client';

import { useState } from 'react';
import { Button, Dialog, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { PublishInput } from '../lib/types';

interface Props {
  open: boolean;
  nextNumber: number;
  /** The first version has nobody to re-induct. */
  isFirst: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onPublish: (input: PublishInput) => void;
}

/** Publishing decides who has to redo the induction and by when (IND-AC6). */
export function PublishDialog({
  open,
  nextNumber,
  isFirst,
  pending,
  error,
  onClose,
  onPublish,
}: Props) {
  const [redo, setRedo] = useState<PublishInput['redo']>('all');
  const [graceDays, setGraceDays] = useState('7');
  const [changeNote, setChangeNote] = useState('');
  const days = Number(graceDays);
  const daysValid = Number.isInteger(days) && days >= 0 && days <= 30;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Publish version ${nextNumber}`}
      description="Published versions can't be edited. Later changes become the next version."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !daysValid}
            onClick={() =>
              onPublish({ redo: isFirst ? 'none' : redo, graceDays: days, changeNote })
            }
          >
            Publish version {nextNumber}
          </Button>
        </>
      }
    >
      <div className="stack">
        {isFirst ? null : (
          <Select
            label="Who needs to redo it?"
            value={redo}
            options={[
              { value: 'all', label: 'Everyone, before their next sign-in' },
              { value: 'none', label: 'Nobody, it is a minor change' },
            ]}
            onChange={(e) => setRedo(e.target.value as PublishInput['redo'])}
          />
        )}
        {isFirst || redo === 'none' ? null : (
          <TextField
            label="Grace period (days)"
            hint="Workers can keep signing in for this long before they must redo it."
            type="number"
            min={0}
            max={30}
            value={graceDays}
            error={daysValid ? undefined : 'Enter a whole number from 0 to 30.'}
            onChange={(e) => setGraceDays(e.target.value)}
          />
        )}
        <Textarea
          label="What changed"
          hint="Optional. Workers see this when they redo the induction."
          rows={3}
          maxLength={1000}
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't publish this version" />
      </div>
    </Dialog>
  );
}
