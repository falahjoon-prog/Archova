'use client';

import { useRef, useState } from 'react';
import { Alert, Button, Dialog, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { SovDraft } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { aud, cents } from '../lib/money';

export interface SovLine {
  code: string;
  description: string;
  value: string;
}

type Proposed = SovLine & { page: number; quote: string };

/**
 * CLM-US1: Nova reads the contract PDF (or its pricing schedule) and proposes schedule of values lines, each with the
 * page and printed row it came from. The person edits, discards or keeps each line; nothing reaches the form until
 * they press Add, and nothing is saved until they save the contract. Nova never adds a line to make the schedule match
 * the contract value: when they differ, the dialog says so.
 */
export function NovaSovDialog({
  open,
  onClose,
  projectId,
  contractValue,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** What the person has typed in the contract value box, to check the lines against. */
  contractValue: string;
  onAdd: (lines: SovLine[]) => void;
}) {
  const { draftSov } = useClaimsMutations(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<SovDraft | null>(null);
  const [lines, setLines] = useState<Proposed[]>([]);

  const typed = contractValue.trim();
  const valueCents = cents(typed);
  const keptCents = lines.reduce((n, l) => n + (cents(l.value) ?? 0), 0);

  function ask() {
    if (!file) return;
    draftSov.mutate(
      { file, contractValue: valueCents !== null && valueCents > 0 ? typed : null },
      {
        onSuccess: (d) => {
          setDraft(d);
          setLines(
            d.lines.map((l) => ({
              code: l.code,
              description: l.description,
              value: l.amount,
              page: l.source.page,
              quote: l.source.quote,
            })),
          );
        },
      },
    );
  }

  function reset() {
    setDraft(null);
    setLines([]);
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    draftSov.reset();
  }

  function close() {
    reset();
    onClose();
  }

  const setLine = (i: number, patch: Partial<SovLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const blankOk = lines.every((l) => l.description.trim() && cents(l.value) !== null);

  const differs = draft && valueCents !== null && lines.length > 0 && keptCents !== valueCents;
  const unread = draft?.unreadPages ?? [];

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Fill the schedule of values with Nova"
      description={
        draft
          ? 'Edit, discard or keep each line. Nothing is added to the form until you press Add, and nothing is saved until you save the contract.'
          : 'Choose the contract PDF, or its pricing schedule. Nova proposes Code, Description and Amount lines, each with the page it came from. Anything unclear is left blank.'
      }
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            Cancel
          </Button>
          {draft ? (
            <Button
              onClick={() => {
                onAdd(lines.map(({ code, description, value }) => ({ code, description, value })));
                close();
              }}
              disabled={lines.length === 0 || !blankOk}
            >
              Add {lines.length} {lines.length === 1 ? 'line' : 'lines'} to the schedule
            </Button>
          ) : (
            <Button onClick={ask} loading={draftSov.isPending} disabled={!file}>
              Read with Nova
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <ErrorAlert error={draftSov.error} title="Nova couldn't read a schedule" />
        {!draft ? (
          <>
            <div className="ac-field">
              <label className="ac-field__label" htmlFor="sov-file">
                Contract or pricing schedule (PDF)
              </label>
              <input
                id="sov-file"
                ref={fileRef}
                className="file-input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="ac-field__hint">
                Nova reads the text in the PDF. Pages that are scans are listed, not read. The file
                is added to this project&apos;s documents.
              </p>
            </div>
            {draftSov.isPending ? (
              <Alert tone="info" title="Nova is reading the document">
                Checking the file, then reading it. This can take a minute.
              </Alert>
            ) : null}
          </>
        ) : (
          <>
            {lines.length === 0 ? (
              <Alert tone="info" title="Nova found no priced lines">
                <p className="u-m-0">
                  The document has no schedule Nova could quote. Add the lines yourself.
                </p>
              </Alert>
            ) : null}
            {differs ? (
              <Alert tone="warning" title="These lines don't add up to the contract value">
                <p className="u-m-0">
                  They add up to {aud((keptCents / 100).toFixed(2))}, not{' '}
                  {aud((valueCents / 100).toFixed(2))}. Nova hasn&apos;t added a line to make up the
                  difference. Check the document, edit a line, or add the missing line yourself.
                </p>
              </Alert>
            ) : null}
            {draft.warnings.includes('prices_include_gst') ? (
              <Alert tone="warning" title="The amounts may include GST">
                <p className="u-m-0">
                  The document says its prices include GST. The schedule is ex GST, so check each
                  amount.
                </p>
              </Alert>
            ) : null}
            {unread.length > 0 || draft.truncated ? (
              <p className="u-caption">
                {unread.length > 0
                  ? `Nova couldn't read page${unread.length === 1 ? '' : 's'} ${unread.join(', ')} (no text). `
                  : ''}
                {draft.truncated ? 'Part of the document was too long to read. ' : ''}
                Lines on those pages may be missing.
              </p>
            ) : null}
            {draft.dropped > 0 ? (
              <p className="u-caption">
                {draft.dropped === 1 ? 'One line was' : `${draft.dropped} lines were`} left out
                because Nova couldn&apos;t match the words and amount to the page.
              </p>
            ) : null}
            <ul className="minutes-items" aria-label="Proposed lines">
              {lines.map((l, i) => (
                <li key={i} className="minutes-item">
                  <div className="form-row">
                    <TextField
                      label={`Code ${i + 1}`}
                      hint={l.code ? undefined : 'No code printed'}
                      value={l.code}
                      aiFilled
                      onChange={(e) => setLine(i, { code: e.target.value })}
                    />
                    <TextField
                      label={`Description ${i + 1}`}
                      value={l.description}
                      aiFilled
                      error={l.description.trim() ? undefined : 'Needed'}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                    <TextField
                      label={`Amount ${i + 1} (ex GST)`}
                      inputMode="decimal"
                      value={l.value}
                      aiFilled
                      error={cents(l.value) === null ? 'Enter a dollar amount' : undefined}
                      onChange={(e) => setLine(i, { value: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      Discard line {i + 1}
                    </Button>
                  </div>
                  <p className="u-caption">
                    Page {l.page}: “{l.quote}”
                  </p>
                </li>
              ))}
            </ul>
            <p className="u-mono" aria-live="polite">
              Total {aud((keptCents / 100).toFixed(2))}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
