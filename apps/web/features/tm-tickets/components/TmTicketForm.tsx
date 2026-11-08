'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useTmMutations, useTmSuggestion } from '../hooks/useTmTickets';
import {
  aud,
  blankLine,
  centsToAmount,
  KINDS,
  lineCents,
  lineProblem,
  type DraftLine,
} from '../lib/tm';

/**
 * Raise a ticket. "Draft from this day" is Nova's suggestion: it fills the lines from that day's timesheets and
 * equipment logs, unpriced, and the person adds the rates and checks every line before saving. Nothing is signed or
 * posted until a person does it.
 */
export function TmTicketForm({ onCreated }: { onCreated: (id: string) => void }) {
  const project = useCurrentProject();
  const { create } = useTmMutations(project.projectId);
  const suggest = useTmSuggestion(project.projectId);
  const today = todayIn(project.timezone);
  const [title, setTitle] = useState('');
  const [workDate, setWorkDate] = useState(today);
  const [location, setLocation] = useState('');
  const [contractor, setContractor] = useState('');
  const [instructedBy, setInstructedBy] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [fromNova, setFromNova] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((n, l) => n + lineCents(l.quantity, l.rate), 0);
  const patch = (key: string, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  function draftFromDay() {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return setError('Enter the work date first.');
    suggest.mutate(workDate, {
      onSuccess: (r) => {
        if (r.lines.length === 0)
          return setError('Nothing to draft from: no timesheets or equipment logs for that day.');
        setLines(
          r.lines.map((l) => ({
            key: crypto.randomUUID(),
            kind: l.kind,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            rate: '',
            ...(l.sourceType && l.sourceId
              ? { sourceType: l.sourceType, sourceId: l.sourceId }
              : {}),
          })),
        );
        setFromNova(true);
        if (!title.trim()) setTitle(`Daywork ${workDate}`);
      },
    });
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Give the ticket a title.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return setError('Enter the date the work was done.');
    if (workDate > today) return setError('Work cannot be dated in the future.');
    const problem = lineProblem(lines);
    if (problem) return setError(problem);
    create.mutate(
      {
        title: title.trim(),
        workDate,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(contractor.trim() ? { contractor: contractor.trim() } : {}),
        ...(instructedBy.trim() ? { instructedBy: instructedBy.trim() } : {}),
        ...(fromNova ? { origin: 'nova' as const } : {}),
        lines: lines.map(({ key: _key, ...l }) => ({
          ...l,
          description: l.description.trim(),
          unit: l.unit.trim(),
          quantity: l.quantity.trim(),
          rate: l.rate.trim(),
        })),
      },
      {
        onSuccess: (t) => {
          setTitle('');
          setDescription('');
          setLocation('');
          setContractor('');
          setInstructedBy('');
          setLines([blankLine()]);
          setFromNova(false);
          onCreated(t.id);
        },
      },
    );
  }

  return (
    <Card title="Raise a T&M ticket">
      <form className="stack-lg" onSubmit={save} noValidate>
        <TextField
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="form-row">
          <TextField
            label="Work date"
            type="date"
            required
            max={today}
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
          <TextField
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Contractor"
            value={contractor}
            onChange={(e) => setContractor(e.target.value)}
          />
          <TextField
            label="Instructed by"
            value={instructedBy}
            onChange={(e) => setInstructedBy(e.target.value)}
          />
        </div>
        <Textarea
          label="Work performed"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="row-actions">
          <Button variant="secondary" onClick={draftFromDay} disabled={suggest.isPending}>
            {suggest.isPending ? 'Drafting…' : 'Draft from this day with Nova'}
          </Button>
          <span className="u-caption">
            Fills labour and equipment from that day’s timesheets and logs. Add the rates and check
            every line.
          </span>
        </div>
        <ErrorAlert error={suggest.error} title="We couldn't draft from that day" />
        {lines.map((l, i) => (
          <fieldset key={l.key} className="stack-md">
            <legend className="u-caption">Line {i + 1}</legend>
            <div className="form-row">
              <Select
                label="Kind"
                options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
                value={l.kind}
                onChange={(e) => patch(l.key, { kind: e.target.value as DraftLine['kind'] })}
              />
              <TextField
                label="Description"
                value={l.description}
                onChange={(e) => patch(l.key, { description: e.target.value })}
              />
            </div>
            <div className="form-row">
              <TextField
                label="Quantity"
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => patch(l.key, { quantity: e.target.value })}
              />
              <TextField
                label="Unit"
                value={l.unit}
                onChange={(e) => patch(l.key, { unit: e.target.value })}
              />
              <TextField
                label="Rate (ex GST)"
                inputMode="decimal"
                value={l.rate}
                onChange={(e) => patch(l.key, { rate: e.target.value })}
              />
              <p className="u-m-0 u-mono u-nowrap">
                {aud(centsToAmount(lineCents(l.quantity, l.rate)))}
              </p>
            </div>
            {lines.length > 1 ? (
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  Remove line {i + 1}
                </Button>
              </div>
            ) : null}
          </fieldset>
        ))}
        <div className="row-actions">
          <Button variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            Add a line
          </Button>
          <strong className="u-mono">Total {aud(centsToAmount(total))} ex GST</strong>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={create.error} title="We couldn't save this ticket" />
        <div className="row-actions">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save ticket'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
