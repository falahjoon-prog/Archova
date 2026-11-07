'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { type LinkEntityType, type LinkReason, LINK_NOTE_MAX } from '@archova/domain';
import { Button, Dialog, Select, SkeletonRows, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { RelatedItemSummary } from '../data/api';
import { useAddLink, useLinkCandidates } from '../hooks/useRelatedItems';
import { REASON_OPTIONS, TYPE_OPTIONS, humanStatus } from '../lib/labels';

/** Pick a record of any type, say how it relates to this one, and link them. */
export function AddRelatedItemDialog({
  projectId,
  from,
  open,
  onClose,
}: {
  projectId: string;
  from: { type: LinkEntityType; id: string };
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddLink(projectId);
  const [type, setType] = useState<LinkEntityType>('rfi');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<RelatedItemSummary | null>(null);
  const [reason, setReason] = useState<LinkReason>('related');
  const [note, setNote] = useState('');

  // Search as the person types, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const found = useLinkCandidates(projectId, type, q, open);
  // The record itself is never offered.
  const options = (found.data?.data ?? []).filter(
    (c) => !(c.type === from.type && c.id === from.id),
  );

  function close() {
    setText('');
    setQ('');
    setPicked(null);
    setReason('related');
    setNote('');
    add.reset();
    onClose();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    add.mutate(
      { from, to: { type: picked.type, id: picked.id }, reason, note: note.trim() || null },
      { onSuccess: close },
    );
  }

  return (
    <Dialog open={open} onClose={close} title="Link an item">
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={add.error} title="We couldn't add the link" />
        <Select
          label="Type"
          options={TYPE_OPTIONS}
          value={type}
          onChange={(e) => {
            setType(e.target.value as LinkEntityType);
            setPicked(null);
          }}
        />
        <TextField
          label="Find by number or words"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        {found.isFetching && !found.data ? <SkeletonRows rows={2} label="Searching…" /> : null}
        {found.data && options.length === 0 ? (
          <p className="u-muted u-m-0">Nothing found that you can open.</p>
        ) : null}
        {options.length > 0 ? (
          <ul className="related-pick" aria-label="Matching items">
            {options.map((c) => (
              <li key={`${c.type}:${c.id}`}>
                <button
                  type="button"
                  className="related-pick__item"
                  aria-pressed={picked?.id === c.id && picked.type === c.type}
                  onClick={() => setPicked(c)}
                >
                  <span className="related-items__ref">{c.ref}</span> {c.title}
                  <span className="u-muted u-caption"> · {humanStatus(c.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Select
          label="How is it related?"
          hint="Read as: this item … the one you picked."
          options={REASON_OPTIONS}
          value={reason}
          onChange={(e) => setReason(e.target.value as LinkReason)}
        />
        <TextField
          label="Note (optional)"
          value={note}
          maxLength={LINK_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="row-actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!picked} loading={add.isPending}>
            Link item
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
