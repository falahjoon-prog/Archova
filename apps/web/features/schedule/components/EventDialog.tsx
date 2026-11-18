'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  Select,
  SkeletonRows,
  StatusPill,
  Textarea,
  TextField,
} from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { useCorrespondenceList } from '@/features/correspondence';
import { useMe } from '@/features/orgs';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import type { DelayEventDraft, DraftKind, EventTransition } from '../data/eot';
import { useDelayEvent, type EotMutations } from '../hooks/useEot';
import { clockView, fmtDate, isLive, ITEM_LABELS, STATUS_LABELS, STATUS_TONES } from '../lib/eot';
import { CAUSE_LABELS } from '../lib/labels';

type Mode = 'notice' | 'claim' | 'assess' | 'withdraw' | null;

const MODE_TITLES: Record<Exclude<Mode, null>, string> = {
  notice: 'Record the notice you gave',
  claim: 'Record the claim you sent',
  assess: "Record the superintendent's assessment",
  withdraw: 'Withdraw this event',
};

/** One delay event: its clocks, evidence pack, Nova's draft letters, and the steps a person records. */
export function EventDialog({
  projectId,
  eventId,
  onClose,
  canWrite,
  tz,
  m,
}: {
  projectId: string;
  eventId: string | null;
  onClose: () => void;
  canWrite: boolean;
  tz: string;
  m: EotMutations;
}) {
  const detail = useDelayEvent(projectId, eventId);
  const me = useMe();
  const e = detail.data?.event;
  const items = detail.data?.items ?? [];
  const history = detail.data?.history ?? [];
  const live = e ? isLive(e.status) : false;
  const editable = canWrite && live;
  const corr = useCorrespondenceList(projectId, {});

  const [mode, setMode] = useState<Mode>(null);
  const [on, setOn] = useState('');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [corrId, setCorrId] = useState('');
  const [draft, setDraft] = useState<(DelayEventDraft & { kind: DraftKind }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteDate, setNoteDate] = useState('');
  const [noteLabel, setNoteLabel] = useState('');
  const [addCorr, setAddCorr] = useState('');
  const [edit, setEdit] = useState<{ days: string; endedOn: string; critical: string } | null>(
    null,
  );

  useEffect(() => {
    setMode(null);
    setDraft(null);
    setEdit(null);
    setError(null);
    setCopied(false);
  }, [eventId]);

  const corrOptions = (corr.data ?? [])
    .filter((c) => c.status !== 'void')
    .map((c) => ({ value: c.id, label: `${c.numberLabel} · ${c.subject}` }));

  function start(next: Exclude<Mode, null>) {
    setMode(next);
    setOn('');
    setNote('');
    setCorrId('');
    setError(null);
    setDays(next === 'claim' && e ? String(e.daysClaimed || e.suggestedDays) : '');
  }

  function submitMode(ev: FormEvent) {
    ev.preventDefault();
    if (!e || !mode) return;
    setError(null);
    const body: EventTransition =
      mode === 'notice'
        ? { action: 'give_notice' }
        : mode === 'claim'
          ? { action: 'submit_claim' }
          : mode === 'assess'
            ? { action: 'record_assessment' }
            : { action: 'withdraw' };
    if (on) body.on = on;
    if (note.trim()) body.note = note.trim();
    if (corrId && (mode === 'notice' || mode === 'claim')) body.correspondenceId = corrId;
    if (mode === 'claim') {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1) return setError('Enter the days you are claiming.');
      body.daysClaimed = n;
    }
    if (mode === 'assess') {
      const n = Number(days);
      if (days.trim() === '' || !Number.isInteger(n) || n < 0)
        return setError('Enter the days granted, or 0 if none.');
      body.daysGranted = n;
    }
    m.transition.mutate(
      { eventId: e.id, body },
      {
        onSuccess: () => {
          setMode(null);
          setDraft(null);
        },
      },
    );
  }

  function simple(action: 'close' | 'reopen') {
    if (e) m.transition.mutate({ eventId: e.id, body: { action } });
  }

  function makeDraft(kind: DraftKind) {
    if (!e) return;
    setCopied(false);
    m.draft.mutate(
      { eventId: e.id, kind, ...(me.data?.user.name ? { senderName: me.data.user.name } : {}) },
      { onSuccess: (d) => setDraft({ ...d, kind }) },
    );
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function saveEdit(ev: FormEvent) {
    ev.preventDefault();
    if (!e || !edit) return;
    const n = Number(edit.days);
    if (!Number.isInteger(n) || n < 0) return setError('Days claimed is a whole number.');
    if (edit.endedOn && edit.endedOn < e.startedOn)
      return setError('The delay must end on or after the day it began.');
    setError(null);
    m.update.mutate(
      {
        eventId: e.id,
        body: {
          daysClaimed: n,
          endedOn: edit.endedOn || null,
          criticalPath: edit.critical === '' ? null : edit.critical === 'yes',
        },
      },
      { onSuccess: () => setEdit(null) },
    );
  }

  function addNote(ev: FormEvent) {
    ev.preventDefault();
    if (!e || !noteLabel.trim()) return;
    m.addEvidence.mutate(
      {
        eventId: e.id,
        body: { notes: [{ label: noteLabel.trim(), ...(noteDate ? { date: noteDate } : {}) }] },
      },
      {
        onSuccess: () => {
          setNoteLabel('');
          setNoteDate('');
        },
      },
    );
  }

  const noticeClock = e ? clockView(e.noticeClock, e.noticeSentOn, 'notice', live) : null;
  const claimClock = e ? clockView(e.claimClock, e.claimSentOn, 'claim', live) : null;
  const busy = m.transition.isPending;

  return (
    <Dialog
      open={eventId !== null}
      onClose={onClose}
      title={e ? `${e.ref} · ${e.title}` : 'Delay event'}
      description={
        e
          ? `${CAUSE_LABELS[e.cause]} · ${fmtDate(e.startedOn)}${e.endedOn ? ` to ${fmtDate(e.endedOn)}` : ' and continuing'}`
          : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isPending ? <SkeletonRows label="Loading the event…" /> : null}
      <ErrorAlert error={detail.error} title="We couldn't load the event" />
      {e && noticeClock && claimClock ? (
        <div className="stack">
          <div className="eot-clocks">
            <StatusPill tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</StatusPill>
            <div className="eot-clock">
              <span className="u-caption">
                Notice of delay{e.noticeClock.overridden ? ' (date set by you)' : ''}
              </span>
              <StatusPill tone={noticeClock.tone}>{noticeClock.text}</StatusPill>
            </div>
            <div className="eot-clock">
              <span className="u-caption">
                EOT claim{e.claimClock.overridden ? ' (date set by you)' : ''}
              </span>
              <StatusPill tone={claimClock.tone}>{claimClock.text}</StatusPill>
            </div>
          </div>
          {!detail.data!.settings.confirmed ? (
            <Alert tone="warning">
              These dates use the {detail.data!.settings.form.toUpperCase()} defaults, not yet
              checked against your contract. Check the contract periods before relying on them.
            </Alert>
          ) : null}

          <dl className="eot-facts">
            <dt>We became aware</dt>
            <dd>{fmtDate(e.awareOn)}</dd>
            <dt>Affected</dt>
            <dd>{e.affected ?? '—'}</dd>
            <dt>Critical path</dt>
            <dd>
              {e.criticalPath === null
                ? 'Not decided'
                : e.criticalPath
                  ? 'On the critical path'
                  : 'Not on the critical path'}
            </dd>
            <dt>Days claimed</dt>
            <dd>
              {e.daysClaimed}
              <span className="u-caption"> (event spans {e.suggestedDays} calendar days)</span>
            </dd>
            {e.assessedOn ? (
              <>
                <dt>Assessment</dt>
                <dd>
                  {e.daysGranted} days granted on {fmtDate(e.assessedOn)}
                  {e.assessmentNote ? ` · ${e.assessmentNote}` : ''}
                </dd>
              </>
            ) : null}
            {e.summary ? (
              <>
                <dt>What happened</dt>
                <dd>{e.summary}</dd>
              </>
            ) : null}
            {e.noticeRefLabel ? (
              <>
                <dt>Notice</dt>
                <dd>{e.noticeRefLabel}</dd>
              </>
            ) : null}
            {e.claimRefLabel ? (
              <>
                <dt>Claim</dt>
                <dd>{e.claimRefLabel}</dd>
              </>
            ) : null}
          </dl>

          {editable ? (
            edit ? (
              <form className="stack" onSubmit={saveEdit} noValidate>
                <div className="form-row">
                  <TextField
                    label="Days claimed"
                    inputMode="numeric"
                    value={edit.days}
                    onChange={(ev) => setEdit({ ...edit, days: ev.target.value })}
                  />
                  <TextField
                    label="Delay ended"
                    type="date"
                    value={edit.endedOn}
                    onChange={(ev) => setEdit({ ...edit, endedOn: ev.target.value })}
                  />
                  <Select
                    label="Critical path"
                    value={edit.critical}
                    onChange={(ev) => setEdit({ ...edit, critical: ev.target.value })}
                    options={[
                      { value: '', label: 'Not decided' },
                      { value: 'yes', label: 'On the critical path' },
                      { value: 'no', label: 'Not on the critical path' },
                    ]}
                  />
                </div>
                <div className="eot-inline">
                  <Button type="submit" size="sm" loading={m.update.isPending}>
                    Save details
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEdit(null)}>
                    Cancel
                  </Button>
                </div>
                <ErrorAlert error={m.update.error} title="We couldn't save that" />
              </form>
            ) : (
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEdit({
                      days: String(e.daysClaimed),
                      endedOn: e.endedOn ?? '',
                      critical: e.criticalPath === null ? '' : e.criticalPath ? 'yes' : 'no',
                    })
                  }
                >
                  Edit details
                </Button>
              </div>
            )
          ) : null}

          {canWrite ? (
            <section aria-label="Next steps" className="stack">
              <h3 className="u-m-0">Next steps</h3>
              {mode ? (
                <form className="stack" onSubmit={submitMode} noValidate>
                  <p className="u-m-0">{MODE_TITLES[mode]}</p>
                  <div className="form-row">
                    <TextField
                      label="Date"
                      type="date"
                      value={on}
                      onChange={(ev) => setOn(ev.target.value)}
                      hint="Blank means today."
                    />
                    {mode === 'claim' || mode === 'assess' ? (
                      <TextField
                        label={mode === 'claim' ? 'Days claimed' : 'Days granted'}
                        inputMode="numeric"
                        value={days}
                        onChange={(ev) => setDays(ev.target.value)}
                      />
                    ) : null}
                  </div>
                  {mode === 'notice' || mode === 'claim' ? (
                    <Select
                      label="Correspondence item"
                      value={corrId}
                      onChange={(ev) => setCorrId(ev.target.value)}
                      placeholder="Not linked"
                      options={corrOptions}
                      hint="Link the notice or claim you wrote in Correspondence."
                    />
                  ) : null}
                  <Textarea
                    label={mode === 'assess' ? 'Assessment note' : 'Note'}
                    value={note}
                    onChange={(ev) => setNote(ev.target.value)}
                    rows={2}
                  />
                  <div className="eot-inline">
                    <Button type="submit" loading={busy}>
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setMode(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="eot-chips">
                  {e.status === 'draft' ? (
                    <Button size="sm" onClick={() => start('notice')}>
                      Record notice given
                    </Button>
                  ) : null}
                  {e.status === 'draft' || e.status === 'notice_given' ? (
                    <Button
                      size="sm"
                      variant={e.status === 'draft' ? 'secondary' : 'primary'}
                      onClick={() => start('claim')}
                    >
                      Record claim sent
                    </Button>
                  ) : null}
                  {e.status === 'claimed' || e.status === 'assessed' ? (
                    <Button size="sm" onClick={() => start('assess')}>
                      {e.status === 'assessed' ? 'Change assessment' : 'Record assessment'}
                    </Button>
                  ) : null}
                  {e.status === 'assessed' || e.status === 'claimed' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => simple('close')}
                      loading={busy}
                    >
                      Close event
                    </Button>
                  ) : null}
                  {live && e.status !== 'assessed' ? (
                    <Button size="sm" variant="tertiary" onClick={() => start('withdraw')}>
                      Withdraw
                    </Button>
                  ) : null}
                  {!live ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => simple('reopen')}
                      loading={busy}
                    >
                      Reopen
                    </Button>
                  ) : null}
                </div>
              )}
              <ErrorAlert error={m.transition.error} title="We couldn't record that" />
            </section>
          ) : null}

          <section aria-label="Nova letters" className="stack">
            <h3 className="u-m-0">
              <NovaIcon size={14} /> Nova letters
            </h3>
            <p className="u-m-0 u-caption">
              Nova writes the draft from the evidence below. You edit and send it. Nothing is sent
              from here.
            </p>
            <div className="eot-chips">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => makeDraft('notice')}
                loading={m.draft.isPending && m.draft.variables?.kind === 'notice'}
              >
                Draft notice of delay
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => makeDraft('claim')}
                loading={m.draft.isPending && m.draft.variables?.kind === 'claim'}
              >
                Draft EOT claim
              </Button>
            </div>
            <ErrorAlert error={m.draft.error} title="We couldn't write the draft" />
            {draft ? (
              <div className="stack">
                {draft.warnings.map((w) => (
                  <Alert key={w} tone="warning">
                    {w}
                  </Alert>
                ))}
                <TextField label="Subject" value={draft.subject} readOnly />
                <Textarea
                  className="eot-draft"
                  label="Draft"
                  value={draft.body}
                  onChange={(ev) => setDraft({ ...draft, body: ev.target.value })}
                  rows={14}
                  aiFilled
                />
                <div className="eot-inline">
                  <Button size="sm" onClick={copy}>
                    {copied ? 'Copied' : 'Copy to paste into Correspondence'}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section aria-label="Evidence" className="stack">
            <h3 className="u-m-0">Evidence ({items.length})</h3>
            {items.length === 0 ? (
              <p className="u-m-0 u-caption">Nothing attached yet.</p>
            ) : (
              <ul className="eot-evidence">
                {items.map((i) => (
                  <li key={i.id} className="eot-item">
                    <span className="eot-item__main">
                      <StatusPill tone="neutral">{ITEM_LABELS[i.kind]}</StatusPill>{' '}
                      {i.date ? `${fmtDate(i.date)} · ` : ''}
                      {i.label}
                      {i.hours !== null ? ` · ${i.hours} h` : ''}
                      {i.days !== null ? ` · ${i.days} days` : ''}
                      {i.detail ? <span className="u-caption"> · {i.detail}</span> : null}
                    </span>
                    {editable ? (
                      <Button
                        size="sm"
                        variant="tertiary"
                        onClick={() => m.removeEvidence.mutate({ eventId: e.id, itemId: i.id })}
                        loading={
                          m.removeEvidence.isPending && m.removeEvidence.variables?.itemId === i.id
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <ErrorAlert
              error={m.removeEvidence.error ?? m.addEvidence.error}
              title="We couldn't change the evidence"
            />
            {editable ? (
              <div className="stack">
                <form className="eot-inline" onSubmit={addNote}>
                  <TextField
                    label="Add a note"
                    value={noteLabel}
                    onChange={(ev) => setNoteLabel(ev.target.value)}
                    hint="For example a phone call, a site instruction or a photo reference."
                  />
                  <TextField
                    label="Date"
                    type="date"
                    value={noteDate}
                    onChange={(ev) => setNoteDate(ev.target.value)}
                  />
                  <Button type="submit" variant="secondary" disabled={!noteLabel.trim()}>
                    Add note
                  </Button>
                </form>
                {corrOptions.length > 0 ? (
                  <div className="eot-inline">
                    <Select
                      label="Add a notice from Correspondence"
                      value={addCorr}
                      onChange={(ev) => setAddCorr(ev.target.value)}
                      placeholder="Pick an item"
                      options={corrOptions}
                    />
                    <Button
                      variant="secondary"
                      disabled={!addCorr}
                      onClick={() =>
                        m.addEvidence.mutate(
                          { eventId: e.id, body: { correspondenceIds: [addCorr] } },
                          { onSuccess: () => setAddCorr('') },
                        )
                      }
                    >
                      Add notice
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <section aria-label="History" className="stack">
            <h3 className="u-m-0">History</h3>
            <ul className="eot-history">
              {history.map((h) => (
                <li key={h.id} className="u-caption">
                  {formatInstant(h.at, tz)} · {h.kind.replace(/_/g, ' ')}
                  {h.detail ? ` · ${h.detail}` : ''}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}
