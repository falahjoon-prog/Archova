'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, Dialog, Select, StatusPill, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import type { DraftedItem, MeetingDetail, MinutesDraft } from '../data/api';
import { useMeetingMutations } from '../hooks/useMeetings';

const KIND: Record<DraftedItem['kind'], string> = {
  information: 'Information',
  decision: 'Decision',
  action: 'Action',
};

/** The section an item goes in unless the person picks another: the one Nova chose, else the first. */
const defaultSection = (item: DraftedItem, detail: MeetingDetail) =>
  item.sectionId && detail.sections.some((s) => s.id === item.sectionId)
    ? item.sectionId
    : (detail.sections[0]?.id ?? '');

/**
 * MTG-US7: paste the notes, Nova proposes minute items, the person ticks the ones to add. Nothing reaches the minutes
 * until they press Add, and every proposed item shows the words of the notes it came from.
 */
export function NovaMinutesDialog({
  open,
  onClose,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  detail: MeetingDetail;
}) {
  const { draftMinutes, addDrafted, rejectDraft } = useMeetingMutations(detail.meeting.id);
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<MinutesDraft | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [section, setSection] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set());

  function ask() {
    draftMinutes.mutate(notes, {
      onSuccess: (d) => {
        setDraft(d);
        setChosen(new Set(d.items.map((_, i) => i)));
        setSection(Object.fromEntries(d.items.map((it, i) => [i, defaultSection(it, detail)])));
        setAdded(new Set());
      },
    });
  }

  function reset() {
    setDraft(null);
    setNotes('');
    draftMinutes.reset();
    addDrafted.reset();
  }

  function close() {
    // A draft the person walks away from is recorded as not used.
    if (draft && added.size === 0 && !addDrafted.isSuccess) rejectDraft.mutate(draft.suggestionId);
    reset();
    onClose();
  }

  function add() {
    if (!draft) return;
    const picked = draft.items
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => chosen.has(i) && !added.has(i));
    addDrafted.mutate(
      {
        suggestionId: draft.suggestionId,
        items: picked.map(({ item, i }) => {
          const who = item.attendeeId
            ? detail.attendees.find((a) => a.id === item.attendeeId)
            : undefined;
          return {
            sectionId: section[i] ?? defaultSection(item, detail),
            kind: item.kind,
            body: item.text,
            ...(who
              ? {
                  ownerName: who.name,
                  ...(who.userId ? { ownerUserId: who.userId } : {}),
                  ...(who.companyId ? { ownerCompanyId: who.companyId } : {}),
                }
              : {}),
            ...(item.dueDate ? { dueDate: item.dueDate } : {}),
          };
        }),
        onAdded: (n) => setAdded((s) => new Set(s).add(picked[n]!.i)),
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  }

  const items = draft?.items ?? [];
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Draft the minutes with Nova"
      description={
        draft
          ? 'Tick the items to add and check the section for each. Nothing is added until you press Add.'
          : 'Paste your notes from the meeting. Nova proposes decisions, actions and information, each with the words of your notes it comes from. Nothing is added until you choose.'
      }
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            Cancel
          </Button>
          {draft ? (
            <Button
              onClick={add}
              loading={addDrafted.isPending}
              disabled={chosen.size === 0 || items.length === 0}
            >
              Add {chosen.size} to the minutes
            </Button>
          ) : (
            <Button
              onClick={ask}
              loading={draftMinutes.isPending}
              disabled={notes.trim().length < 20}
            >
              Draft with Nova
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <ErrorAlert error={draftMinutes.error} title="Nova couldn't read these notes" />
        <ErrorAlert error={addDrafted.error} title="We couldn't add every item" />
        {!draft ? (
          <Textarea
            label="Meeting notes"
            hint="Typed or pasted text. Say who is to do what and by when, as you would in the room."
            rows={10}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        ) : (
          <>
            {items.length === 0 ? (
              <Alert tone="info" title="Nova found nothing to add">
                <p className="u-m-0">
                  The notes had no decisions, actions or facts it could quote. Go back and add more
                  detail.
                </p>
              </Alert>
            ) : null}
            {draft.dropped > 0 ? (
              <p className="u-caption">
                {draft.dropped === 1
                  ? 'One proposed item was'
                  : `${draft.dropped} proposed items were`}{' '}
                left out because the notes didn&apos;t back them.
              </p>
            ) : null}
            <ul className="minutes-items" aria-label="Proposed items">
              {items.map((item, i) => {
                const who = item.attendeeId
                  ? detail.attendees.find((a) => a.id === item.attendeeId)
                  : undefined;
                return (
                  <li key={i} className="minutes-item">
                    <Checkbox
                      label={item.text}
                      checked={chosen.has(i) && !added.has(i)}
                      disabled={added.has(i)}
                      onChange={(e) =>
                        setChosen((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(i);
                          else n.delete(i);
                          return n;
                        })
                      }
                    />
                    <div className="details-row">
                      <StatusPill tone={item.kind === 'action' ? 'warning' : 'neutral'}>
                        {KIND[item.kind]}
                      </StatusPill>
                      {who ? <span className="u-caption">Owner: {who.name}</span> : null}
                      {item.dueDate ? (
                        <span className="u-caption">Due {formatLocalDate(item.dueDate)}</span>
                      ) : null}
                      {added.has(i) ? <span className="u-caption">Added</span> : null}
                    </div>
                    <Select
                      label="Section"
                      options={detail.sections.map((s) => ({ value: s.id, label: s.title }))}
                      value={section[i] ?? ''}
                      onChange={(e) => setSection((s) => ({ ...s, [i]: e.target.value }))}
                    />
                    <p className="u-caption">From your notes: “{item.quote}”</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
