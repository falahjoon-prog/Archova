'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  Select,
  SignaturePad,
  TextField,
  Textarea,
  type SignatureValue,
} from '@archova/ui';
import { localDateOf } from '@archova/time';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useSwmsOptions, useTemplates } from '../hooks/usePretask';
import { signatureToPng } from '../lib/signature';
import type { Hazard, PlanInput, Suggestion } from '../lib/types';
import { HazardEditor, blankHazard } from './HazardEditor';
import { Suggestions } from './Suggestions';

export interface CompanyOption {
  id: string;
  name: string;
}

const namesOf = (text: string) =>
  text
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);

const asHazard = (s: Suggestion): Hazard => ({
  hazard: s.hazard,
  riskBefore: s.riskBefore,
  controls: s.controls,
  riskAfter: 'low',
});

export function NewPlanDialog({
  companies,
  timeZone,
  supervisor,
  pending,
  error,
  onClose,
  onSave,
}: {
  companies: CompanyOption[];
  timeZone: string;
  supervisor: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: PlanInput) => void;
}) {
  const swms = useSwmsOptions();
  const templates = useTemplates();
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => localDateOf(new Date(), timeZone));
  const [by, setBy] = useState(supervisor);
  const [location, setLocation] = useState('');
  const [company, setCompany] = useState('');
  const [swmsId, setSwmsId] = useState('');
  const [hazards, setHazards] = useState<Hazard[]>([blankHazard()]);
  const [names, setNames] = useState('');
  const crew = namesOf(names);
  const filled = hazards.filter((h) => h.hazard.trim());
  return (
    <Dialog
      open
      onClose={onClose}
      title="New pre-task plan"
      description="Before the task starts: what could go wrong, how you will control it, and who is doing it. Each person then signs on."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !by.trim() || !date || pending}
            onClick={() =>
              onSave({
                taskTitle: title.trim(),
                workDate: date,
                supervisorName: by.trim(),
                hazards: filled,
                crew: crew.map((personName) => ({
                  personName,
                  ...(company ? { companyId: company } : {}),
                })),
                ...(location.trim() ? { location: location.trim() } : {}),
                ...(company ? { companyId: company } : {}),
                ...(swmsId ? { swmsId } : {}),
              })
            }
          >
            Start plan
          </Button>
        </>
      }
    >
      <div className="stack">
        {(templates.data ?? []).some((t) => t.isActive) ? (
          <Select
            label="Start from a template"
            value={templateId}
            placeholder="Blank plan"
            options={(templates.data ?? [])
              .filter((t) => t.isActive)
              .map((t) => ({ value: t.id, label: t.name }))}
            onChange={(e) => {
              const t = (templates.data ?? []).find((x) => x.id === e.target.value);
              setTemplateId(e.target.value);
              if (!t) return;
              setTitle(t.taskTitle);
              setSwmsId(t.swmsId ?? '');
              setHazards(t.hazards.length ? t.hazards.map((h) => ({ ...h })) : [blankHazard()]);
            }}
          />
        ) : null}
        <TextField label="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Work date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField label="Supervisor" value={by} onChange={(e) => setBy(e.target.value)} />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <Select
          label="Company doing the work"
          value={company}
          placeholder="Not recorded"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <Select
          label="SWMS this work falls under"
          value={swmsId}
          placeholder="None linked"
          options={(swms.data ?? []).map((s) => ({ value: s.id, label: s.label }))}
          onChange={(e) => setSwmsId(e.target.value)}
        />
        <Suggestions
          swmsId={swmsId || undefined}
          have={hazards}
          onAdd={(s) =>
            setHazards((cur) => [
              ...cur.filter((h) => h.hazard.trim() || h.controls.trim()),
              asHazard(s),
            ])
          }
        />
        <HazardEditor hazards={hazards} onChange={setHazards} />
        <Textarea
          label="Who is doing the task (one name per line)"
          value={names}
          onChange={(e) => setNames(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't start the plan" />
      </div>
    </Dialog>
  );
}

export function EditHazardsDialog({
  initial,
  planId,
  swmsId,
  pending,
  error,
  onClose,
  onSave,
}: {
  initial: Hazard[];
  planId: string;
  swmsId: string | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (hazards: Hazard[]) => void;
}) {
  const [hazards, setHazards] = useState<Hazard[]>(initial.length ? initial : [blankHazard()]);
  const filled = hazards.filter((h) => h.hazard.trim());
  return (
    <Dialog
      open
      onClose={onClose}
      title="Hazards and controls"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSave(filled)}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Suggestions
          planId={planId}
          {...(swmsId ? { swmsId } : {})}
          have={hazards}
          onAdd={(s) =>
            setHazards((cur) => [
              ...cur.filter((h) => h.hazard.trim() || h.controls.trim()),
              asHazard(s),
            ])
          }
        />
        <HazardEditor hazards={hazards} onChange={setHazards} />
        <ErrorAlert error={error} title="We couldn't save the hazards" />
      </div>
    </Dialog>
  );
}

export function AddCrewDialog({
  companies,
  pending,
  error,
  onClose,
  onSave,
}: {
  companies: CompanyOption[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (people: { personName: string; companyId?: string }[]) => void;
}) {
  const [names, setNames] = useState('');
  const [company, setCompany] = useState('');
  const people = namesOf(names);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add people"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={people.length === 0 || pending}
            onClick={() =>
              onSave(
                people.map((personName) => ({
                  personName,
                  ...(company ? { companyId: company } : {}),
                })),
              )
            }
          >
            Add to plan
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea
          label="Names (one per line)"
          value={names}
          onChange={(e) => setNames(e.target.value)}
        />
        <Select
          label="Company"
          value={company}
          placeholder="Not recorded"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't add them" />
      </div>
    </Dialog>
  );
}

/** One person signs on, on the device: drawn, or typed with a confirmation. The image is what the server stores. */
export function SignDialog({
  name,
  pending,
  error,
  onClose,
  onSign,
}: {
  name: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSign: (image: Blob) => void;
}) {
  const [value, setValue] = useState<SignatureValue>(null);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Sign on for ${name}`}
      description="By signing, you confirm you have read the hazards and controls and will work to them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!value || pending}
            onClick={() => {
              if (!value) return;
              signatureToPng(value).then(onSign, (e: Error) => setFailed(e.message));
            }}
          >
            Sign on
          </Button>
        </>
      }
    >
      <div className="stack">
        <SignaturePad name={name} onChange={setValue} />
        {failed ? <p role="alert">{failed}</p> : null}
        <ErrorAlert error={error} title="We couldn't save the signature" />
      </div>
    </Dialog>
  );
}

export function ReviewDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (note: string | null) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Review this plan"
      description="Sign off that you have looked over the hazards, controls and who signed on."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSave(note.trim() || null)}>
            Mark reviewed
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the review" />
      </div>
    </Dialog>
  );
}

export function SaveTemplateDialog({
  defaultName,
  pending,
  error,
  onClose,
  onSave,
}: {
  defaultName: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Save as template"
      description="The task, SWMS and hazards are kept so the next plan starts from them. Crew and signatures are not copied."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || pending} onClick={() => onSave(name.trim())}>
            Save template
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the template" />
      </div>
    </Dialog>
  );
}
