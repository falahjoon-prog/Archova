'use client';

import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Dialog, Textarea, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { MeetingDetail } from '../data/api';
import { useMeetingMutations } from '../hooks/useMeetings';

/** MTG-US8: freeze the minutes as the next version and say who they go to. A correction is another issue. */
export function IssueDialog({
  open,
  onClose,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  detail: MeetingDetail;
}) {
  const { issue } = useMeetingMutations(detail.meeting.id);
  const candidates = detail.attendees.filter((a) => a.email && a.attendance !== 'absent');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(candidates.map((a) => a.id)),
  );
  const [extra, setExtra] = useState('');
  const [correctionsBy, setCorrectionsBy] = useState(detail.meeting.correctionsBy ?? '');
  const [note, setNote] = useState('');
  const next = detail.meeting.issuedVersion + 1;

  function submit(e: FormEvent) {
    e.preventDefault();
    const recipients = [
      ...candidates.filter((a) => chosen.has(a.id)).map((a) => ({ name: a.name, email: a.email! })),
      ...extra
        .split(/[,\s;]+/)
        .filter(Boolean)
        .map((email) => ({ name: email, email })),
    ];
    issue.mutate(
      {
        recipients,
        correctionsBy: correctionsBy || null,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={next === 1 ? 'Issue the minutes' : `Issue a correction (version ${next})`}
      description="This freezes the minutes as they stand now. Earlier versions stay available. Sections marked builder only are left out of what outsiders see."
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="issue-form" loading={issue.isPending}>
            Issue version {next}
          </Button>
        </>
      }
    >
      <form id="issue-form" className="stack" onSubmit={submit} noValidate>
        <ErrorAlert error={issue.error} title="We couldn't issue the minutes" />
        <fieldset className="fieldset">
          <legend className="panel-heading">Send to</legend>
          {candidates.length === 0 ? (
            <p className="u-muted">No attendee has an email address. Add addresses below.</p>
          ) : null}
          {candidates.map((a) => (
            <Checkbox
              key={a.id}
              label={`${a.name} (${a.email})`}
              checked={chosen.has(a.id)}
              onChange={(e) =>
                setChosen((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(a.id);
                  else n.delete(a.id);
                  return n;
                })
              }
            />
          ))}
        </fieldset>
        <TextField
          label="Other email addresses"
          hint="Separate with commas."
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
        <TextField
          label="Corrections by"
          type="date"
          hint="Optional. Printed on the minutes."
          value={correctionsBy}
          onChange={(e) => setCorrectionsBy(e.target.value)}
        />
        <Textarea
          label="Note to recipients"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
