'use client';

import { useState } from 'react';
import { Button, Card, Select, TextField } from '@archova/ui';
import { Trash2 } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { Attendance, MeetingDetail } from '../data/api';
import { useMeetingMutations } from '../hooks/useMeetings';
import { ATTENDANCE_LABELS } from '../lib/labels';

type Row = MeetingDetail['attendees'][number];

const OPTIONS = Object.entries(ATTENDANCE_LABELS).map(([value, label]) => ({ value, label }));

const person = (a: Row) => ({
  name: a.name,
  companyName: a.companyName,
  role: a.role,
  email: a.email,
  userId: a.userId,
  companyId: a.companyId,
});

/** MTG-US3: who was there. Each change saves the whole list, which is short. */
export function AttendanceCard({
  meetingId,
  attendees,
  canEdit,
}: {
  meetingId: string;
  attendees: readonly Row[];
  canEdit: boolean;
}) {
  const { setAttendees } = useMeetingMutations(meetingId);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const save = (rows: Array<ReturnType<typeof person> & { attendance: Attendance }>) =>
    setAttendees.mutate(rows);
  const current = attendees.map((a) => ({ ...person(a), attendance: a.attendance }));

  return (
    <Card title="Attendance">
      <div className="stack">
        <ErrorAlert error={setAttendees.error} title="We couldn't save attendance" />
        {attendees.length === 0 ? <p className="u-muted">Nobody is listed yet.</p> : null}
        <ul className="minutes-people">
          {attendees.map((a, i) => (
            <li key={a.id} className="minutes-people__row">
              <span>
                <strong>{a.name}</strong>
                <span className="u-muted">
                  {[a.companyName, a.role].filter(Boolean).length
                    ? `, ${[a.companyName, a.role].filter(Boolean).join(', ')}`
                    : ''}
                </span>
              </span>
              {canEdit ? (
                <span className="minutes-people__controls">
                  <Select
                    label={`Attendance for ${a.name}`}
                    options={OPTIONS}
                    value={a.attendance}
                    onChange={(e) =>
                      save(
                        current.map((c, j) =>
                          j === i ? { ...c, attendance: e.target.value as Attendance } : c,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="tertiary"
                    size="sm"
                    iconOnly
                    aria-label={`Remove ${a.name}`}
                    onClick={() => save(current.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                </span>
              ) : (
                <span className="u-muted">{ATTENDANCE_LABELS[a.attendance]}</span>
              )}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <form
            className="form-row"
            aria-label="Add an attendee"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              save([
                ...current,
                {
                  name: name.trim(),
                  companyName: company.trim(),
                  role: '',
                  email: email.trim() || null,
                  userId: null,
                  companyId: null,
                  attendance: 'present',
                },
              ]);
              setName('');
              setCompany('');
              setEmail('');
            }}
          >
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              label="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <TextField
              label="Email"
              type="email"
              hint="So they can be sent the minutes."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant="secondary" loading={setAttendees.isPending}>
              Add attendee
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
