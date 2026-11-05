'use client';

import { useState } from 'react';
import { Button, Dialog, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useSourceOptions } from '../hooks/useIncidents';
import { isoToProjectLocal, nowProjectLocal, projectLocalToIso } from '../lib/time';
import {
  ACTION_LABELS,
  CLASSES,
  CLASS_LABELS,
  ROLES,
  ROLE_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  TYPES,
  TYPE_LABELS,
  needsReason,
  type ActionInput,
  type ClassifyInput,
  type IncidentAction,
  type IncidentDetail,
  type IncidentType,
  type NotifiableClass,
  type PersonInput,
  type PersonRole,
  type ReportInput,
  type Severity,
} from '../lib/types';

type Dir = ReturnType<typeof useProjectDirectory>;

export function ReportDialog({
  dir,
  timeZone,
  pending,
  error,
  onClose,
  onSave,
}: {
  dir: Dir;
  timeZone: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: ReportInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<IncidentType>('near_miss');
  const [when, setWhen] = useState(() => nowProjectLocal(timeZone));
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [immediate, setImmediate] = useState('');
  const [people, setPeople] = useState<PersonInput[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<PersonRole>('injured');
  const [company, setCompany] = useState('');
  const iso = projectLocalToIso(when, timeZone);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Report incident"
      description="Record what happened while it is fresh. The builder classifies it and finds the cause afterwards."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !iso || pending}
            onClick={() =>
              iso &&
              onSave({
                title: title.trim(),
                type,
                occurredAt: iso,
                location: location.trim() || undefined,
                description: description.trim() || undefined,
                immediateActions: immediate.trim() || undefined,
                people: people.length ? people : undefined,
              })
            }
          >
            {pending ? 'Reporting…' : 'Report incident'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select
          label="Type"
          value={type}
          options={TYPES.map((v) => ({ value: v, label: TYPE_LABELS[v] }))}
          onChange={(e) => setType(e.target.value as IncidentType)}
        />
        <TextField
          label="When it happened"
          type="datetime-local"
          hint={`Time in ${timeZone}.`}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <TextField label="Where" value={location} onChange={(e) => setLocation(e.target.value)} />
        <Textarea
          label="What happened"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Textarea
          label="What was done straight away"
          value={immediate}
          onChange={(e) => setImmediate(e.target.value)}
        />
        <fieldset className="stack">
          <legend>People involved</legend>
          {people.length > 0 ? (
            <ul>
              {people.map((p, i) => (
                <li key={`${p.personName}-${i}`}>
                  {p.personName} · {ROLE_LABELS[p.role]}
                  {p.companyId ? ` · ${dir.companyName(p.companyId)}` : ''}{' '}
                  <Button
                    variant="tertiary"
                    aria-label={`Remove ${p.personName}`}
                    onClick={() => setPeople((cur) => cur.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select
            label="Role"
            value={role}
            options={ROLES.map((v) => ({ value: v, label: ROLE_LABELS[v] }))}
            onChange={(e) => setRole(e.target.value as PersonRole)}
          />
          <Select
            label="Company"
            value={company}
            placeholder="Not set"
            options={dir.companies
              .filter((c) => dir.onProject(c.id))
              .map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => setCompany(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!name.trim()}
            onClick={() => {
              setPeople((cur) => [
                ...cur,
                { personName: name.trim(), role, ...(company ? { companyId: company } : {}) },
              ]);
              setName('');
            }}
          >
            Add person
          </Button>
        </fieldset>
        <ErrorAlert error={error} title="We couldn't report the incident" />
      </div>
    </Dialog>
  );
}

export function ClassifyDialog({
  detail,
  timeZone,
  pending,
  error,
  onClose,
  onSave,
}: {
  detail: IncidentDetail;
  timeZone: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: ClassifyInput) => void;
}) {
  const i = detail.incident;
  const [severity, setSeverity] = useState<Severity>(i.severity);
  const [notifiable, setNotifiable] = useState(i.isNotifiable);
  const [cls, setCls] = useState<NotifiableClass | ''>(i.notifiableClass ?? '');
  const [notified, setNotified] = useState(isoToProjectLocal(i.regulatorNotifiedAt, timeZone));
  const [asked, setAsked] = useState(isoToProjectLocal(i.writtenNoticeRequestedAt, timeZone));
  const [method, setMethod] = useState(i.rootCause?.method ?? 'five_whys');
  const [causes, setCauses] = useState((i.rootCause?.causes ?? []).join('\n'));
  const [summary, setSummary] = useState(i.rootCause?.summary ?? '');
  const hasCause = causes.trim() !== '' || summary.trim() !== '';
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Classify ${i.numberLabel}`}
      description="Severity, whether the regulator must be told, and the root cause."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(notifiable && !cls) || pending}
            onClick={() =>
              onSave({
                severity,
                isNotifiable: notifiable,
                notifiableClass: notifiable && cls ? cls : null,
                regulatorNotifiedAt: projectLocalToIso(notified, timeZone),
                writtenNoticeRequestedAt: projectLocalToIso(asked, timeZone),
                rootCause: hasCause
                  ? {
                      method,
                      causes: causes
                        .split('\n')
                        .map((c) => c.trim())
                        .filter(Boolean),
                      summary: summary.trim(),
                    }
                  : null,
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Severity"
          value={severity}
          options={SEVERITIES.map((v) => ({ value: v, label: SEVERITY_LABELS[v] }))}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        />
        <Select
          label="Notifiable to the regulator"
          value={notifiable ? 'yes' : 'no'}
          options={[
            { value: 'no', label: 'No' },
            { value: 'yes', label: 'Yes' },
          ]}
          onChange={(e) => setNotifiable(e.target.value === 'yes')}
        />
        {notifiable ? (
          <>
            <Select
              label="Notifiable class"
              value={cls}
              placeholder="Choose a class"
              options={CLASSES.map((v) => ({ value: v, label: CLASS_LABELS[v] }))}
              onChange={(e) => setCls(e.target.value as NotifiableClass)}
            />
            <TextField
              label="Regulator notified"
              type="datetime-local"
              hint={`Time in ${timeZone}. Archova does not notify the regulator for you.`}
              value={notified}
              onChange={(e) => setNotified(e.target.value)}
            />
            <TextField
              label="Regulator asked for written notice"
              type="datetime-local"
              hint="Starts the 48 hour countdown."
              value={asked}
              onChange={(e) => setAsked(e.target.value)}
            />
          </>
        ) : null}
        <Select
          label="Root cause method"
          value={method}
          options={[
            { value: 'five_whys', label: 'Five whys' },
            { value: 'fishbone', label: 'Fishbone' },
            { value: 'other', label: 'Other' },
          ]}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        />
        <Textarea
          label="Causes found"
          hint="One per line."
          value={causes}
          onChange={(e) => setCauses(e.target.value)}
        />
        <Textarea
          label="Root cause summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't save the classification" />
      </div>
    </Dialog>
  );
}

export function TransitionDialog({
  detail,
  action,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  detail: IncidentDetail;
  action: IncidentAction;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const mustGiveReason = needsReason(action);
  const blocked = action === 'close' && detail.closeBlockers.length > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${ACTION_LABELS[action]} ${detail.incident.numberLabel}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(mustGiveReason && !reason.trim()) || blocked || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? 'Saving…' : ACTION_LABELS[action]}
          </Button>
        </>
      }
    >
      <div className="stack">
        {blocked ? (
          <ul>
            {detail.closeBlockers.map((b) => (
              <li key={b.field}>{b.message}</li>
            ))}
          </ul>
        ) : null}
        {mustGiveReason ? (
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        ) : null}
        <ErrorAlert error={error} title="We couldn't update the incident" />
      </div>
    </Dialog>
  );
}

export function ActionDialog({
  dir,
  pending,
  error,
  onClose,
  onSave,
}: {
  dir: Dir;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: ActionInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [company, setCompany] = useState('');
  const [due, setDue] = useState('');
  const [sourceType, setSourceType] = useState<'' | 'inspection' | 'observation'>('');
  const [sourceId, setSourceId] = useState('');
  const options = useSourceOptions(sourceType !== '');
  const choices = (options.data ?? []).filter((o) => o.type === sourceType);
  const source = sourceType && sourceId ? { type: sourceType, id: sourceId } : undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add corrective action"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                title: title.trim(),
                description: description.trim() || undefined,
                assigneeCompanyId: company || undefined,
                dueDate: due || undefined,
                ...(source ? { source } : {}),
              })
            }
          >
            {pending ? 'Adding…' : 'Add action'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Action" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          label="Details"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Select
          label="Assigned company"
          value={company}
          placeholder="Not assigned"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Select
          label="Raised from"
          value={sourceType}
          placeholder="Not linked"
          options={[
            { value: 'inspection', label: 'An inspection' },
            { value: 'observation', label: 'An observation' },
          ]}
          onChange={(e) => {
            setSourceType(e.target.value as '' | 'inspection' | 'observation');
            setSourceId('');
          }}
        />
        {sourceType ? (
          <Select
            label={sourceType === 'inspection' ? 'Inspection' : 'Observation'}
            value={sourceId}
            placeholder={options.isPending ? 'Loading…' : 'Choose one'}
            options={choices.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(e) => setSourceId(e.target.value)}
          />
        ) : null}
        <ErrorAlert error={options.error} title="We couldn't load the list" />
        <ErrorAlert error={error} title="We couldn't add the action" />
      </div>
    </Dialog>
  );
}
