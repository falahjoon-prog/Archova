'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Select,
  SkeletonRows,
  Textarea,
  TextField,
} from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { CreateDelayEvent, DelayEventCandidate } from '../data/eot';
import { useEventCandidates, type EotMutations } from '../hooks/useEot';
import { fmtDate, ITEM_LABELS } from '../lib/eot';
import { CAUSE_LABELS } from '../lib/labels';

const CAUSES = Object.entries(CAUSE_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Group delays into an event. The register's delays, RFI impacts and rain days are offered as evidence, and Nova fills
 * the title, cause, dates and a starting day count from the ones picked. Every field stays editable.
 */
export function NewEventDialog({
  projectId,
  open,
  onClose,
  m,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  m: EotMutations;
}) {
  const cands = useEventCandidates(projectId, open);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState('');
  const [cause, setCause] = useState<CreateDelayEvent['cause']>('weather');
  const [startedOn, setStartedOn] = useState('');
  const [endedOn, setEndedOn] = useState('');
  const [awareOn, setAwareOn] = useState('');
  const [days, setDays] = useState('');
  const [affected, setAffected] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  const rows = cands.data?.data ?? [];
  const chosen = rows.filter((r) => picked.has(r.key));

  function reset() {
    setPicked(new Set());
    setTitle('');
    setStartedOn('');
    setEndedOn('');
    setAwareOn('');
    setDays('');
    setAffected('');
    setSummary('');
    setError(null);
    setFilled(false);
  }
  function toggle(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  }
  function fillFromPicked() {
    setError(null);
    if (chosen.length === 0) return setError('Pick at least one delay, RFI or rain day first.');
    const dates = chosen.map((c) => c.date).sort();
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    // The cause most of the picked evidence points to; ties go to the newest.
    const counts = new Map<string, number>();
    for (const c of chosen) counts.set(c.cause, (counts.get(c.cause) ?? 0) + 1);
    const top = [...counts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]![0] as CreateDelayEvent['cause'];
    const span =
      Math.round(
        (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000,
      ) + 1;
    setCause(top);
    setStartedOn(first);
    setEndedOn(last);
    setAwareOn(first);
    setDays(String(span));
    if (!title.trim()) setTitle(`${CAUSE_LABELS[top]} delay, ${fmtDate(first)}`);
    setFilled(true);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Enter a title for the event.');
    if (!startedOn) return setError('Enter the day the delay began.');
    if (endedOn && endedOn < startedOn)
      return setError('The delay must end on or after the day it began.');
    const n = days.trim() === '' ? 0 : Number(days);
    if (!Number.isInteger(n) || n < 0) return setError('Days claimed is a whole number.');
    const body: CreateDelayEvent = {
      title: title.trim(),
      cause,
      startedOn,
      ...(endedOn ? { endedOn } : {}),
      ...(awareOn ? { awareOn } : {}),
      ...(n > 0 ? { daysClaimed: n } : {}),
      ...(affected.trim() ? { affected: affected.trim() } : {}),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      ...(picked.size ? { candidateKeys: [...picked] } : {}),
    };
    m.create.mutate(body, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New delay event"
      description="Group the delays that belong together. The notice period counts from the day you became aware."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-eot-form" loading={m.create.isPending}>
            Create event
          </Button>
        </>
      }
    >
      <form id="new-eot-form" className="stack" onSubmit={save} noValidate>
        <fieldset className="stack">
          <legend className="u-caption">Evidence from the register</legend>
          {cands.isPending ? <SkeletonRows label="Loading delays…" /> : null}
          <ErrorAlert error={cands.error} title="We couldn't load the delays" />
          {cands.data && rows.length === 0 ? (
            <p className="u-m-0 u-caption">
              Nothing left to group: every recent delay is already in an event. You can still create
              an event and add notes.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <ul className="eot-pick">
              {rows.map((c: DelayEventCandidate) => (
                <li key={c.key}>
                  <Checkbox
                    label={`${fmtDate(c.date)} · ${ITEM_LABELS[c.kind]} · ${c.label}`}
                    hint={
                      c.hours !== null
                        ? `${c.hours} h lost${c.possibleEot ? ' · possible EOT' : ''}`
                        : c.days !== null
                          ? `${c.days} days${c.possibleEot ? ' · possible EOT' : ''}`
                          : (c.detail ?? undefined)
                    }
                    checked={picked.has(c.key)}
                    onChange={() => toggle(c.key)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {cands.data?.truncated ? (
            <p className="u-caption u-m-0" role="status">
              Only the most recent rows are shown.
            </p>
          ) : null}
          <div>
            <Button variant="secondary" onClick={fillFromPicked} disabled={picked.size === 0}>
              <NovaIcon size={14} /> Fill the event from these with Nova
            </Button>
          </div>
          {filled ? (
            <Alert tone="info">
              Nova set the cause, dates and a starting day count from the {picked.size} picked. The
              days are the calendar span, not an entitlement. Check each field.
            </Alert>
          ) : null}
        </fieldset>
        <TextField
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="form-row">
          <Select
            label="Cause"
            value={cause}
            onChange={(e) => setCause(e.target.value as CreateDelayEvent['cause'])}
            options={CAUSES}
          />
          <TextField
            label="Days claimed"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Delay began"
            type="date"
            required
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
          <TextField
            label="Delay ended"
            type="date"
            value={endedOn}
            onChange={(e) => setEndedOn(e.target.value)}
            hint="Leave blank while it continues."
          />
          <TextField
            label="We became aware"
            type="date"
            value={awareOn}
            onChange={(e) => setAwareOn(e.target.value)}
            hint="Starts the notice clock. Blank means the day it began."
          />
        </div>
        <TextField
          label="Activities and areas affected"
          value={affected}
          onChange={(e) => setAffected(e.target.value)}
        />
        <Textarea
          label="What happened"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.create.error} title="We couldn't create the event" />
      </form>
    </Dialog>
  );
}
