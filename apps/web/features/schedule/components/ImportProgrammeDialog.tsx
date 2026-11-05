'use client';

import { useState, type ChangeEvent } from 'react';
import { Alert, Button, Dialog, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useProgrammeMutations } from '../hooks/useProgramme';
import { MAX_IMPORT_CHARS, formatForFile } from '../lib/labels';

/** SCH-AC6: bring in a programme revision from MS Project (XML) or Primavera P6 (XER). */
export function ImportProgrammeDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (scheduleId: string) => void;
}) {
  const m = useProgrammeMutations(null);
  const [format, setFormat] = useState<'msp' | 'p6'>('msp');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProblem(null);
    const text = await file.text();
    if (text.length > MAX_IMPORT_CHARS) {
      setContent('');
      setFileName('');
      setProblem(
        'That file is over 900 KB. Save the programme without baselines or resources and try again.',
      );
      return;
    }
    setContent(text);
    setFileName(file.name);
    setFormat(formatForFile(file.name) ?? format);
  }

  function submit() {
    if (!content) return setProblem('Choose a file first.');
    m.importFile.mutate(
      { format, content, ...(name.trim() ? { name: name.trim() } : {}) },
      {
        onSuccess: (r) => {
          setPendingId(r.detail.schedule.id);
          if (r.skipped.length) setSkipped(r.skipped);
          else done(r.detail.schedule.id);
        },
      },
    );
  }
  function done(id: string) {
    setContent('');
    setFileName('');
    setName('');
    setSkipped(null);
    onImported(id);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={skipped && pendingId ? () => done(pendingId) : onClose}
      title="Import a programme"
      description="Adds a new revision; your earlier programmes stay as they are. Summary rows are left out."
      footer={
        skipped && pendingId ? (
          <Button onClick={() => done(pendingId)}>Open the programme</Button>
        ) : (
          <>
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={m.importFile.isPending}>
              Import
            </Button>
          </>
        )
      }
    >
      {skipped ? (
        <div className="stack">
          <Alert tone="warning" title="Imported, with some rows left out">
            <ul>
              {skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : (
        <div className="stack">
          <ErrorAlert error={m.importFile.error} title="We couldn't import that file" />
          {problem ? <Alert tone="danger" title={problem} /> : null}
          <Select
            label="File type"
            options={[
              { value: 'msp', label: 'MS Project XML (.xml)' },
              { value: 'p6', label: 'Primavera P6 (.xer)' },
            ]}
            value={format}
            onChange={(e) => setFormat(e.target.value as 'msp' | 'p6')}
          />
          <div className="stack stack--tight">
            <label htmlFor="programme-file" className="ac-field__label">
              Programme file
            </label>
            <input
              id="programme-file"
              type="file"
              accept=".xml,.xer,text/xml"
              onChange={pick}
              className="file-input"
            />
            {fileName ? <span className="u-caption">{fileName}</span> : null}
          </div>
          <TextField
            label="Name"
            hint="Optional. Defaults to the name in the file."
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}
    </Dialog>
  );
}
