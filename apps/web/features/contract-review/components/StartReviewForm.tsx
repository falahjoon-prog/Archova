'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, Select } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BaseForm, ContractType, OurSide } from '../data/api';
import { useContractReviewMutations } from '../hooks/useContractReview';
import { BASE_FORMS, CONTRACT_TYPES, OUR_SIDES } from '../lib/labels';

/** CR1: the contract PDF and what Nova should compare it against. Nova reads the text layer; scanned pages are listed, not read. */
export function StartReviewForm({ onDone }: { onDone: (suggestionId: string) => void }) {
  const project = useCurrentProject();
  const { start } = useContractReviewMutations(project.projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [contractType, setContractType] = useState<ContractType>('subcontract');
  const [ourSide, setOurSide] = useState<OurSide>('we_pay');
  const [baseForm, setBaseForm] = useState<BaseForm | ''>('');
  const [multiState, setMultiState] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    start.mutate(
      { file, contractType, ourSide, baseForm: baseForm || null, multiState },
      { onSuccess: (r) => onDone(r.suggestionId) },
    );
  };

  return (
    <form className="stack" onSubmit={submit} aria-label="Start a Nova contract review">
      <div className="ac-field">
        <label className="ac-field__label" htmlFor="cr-file">
          Contract (PDF)
        </label>
        <input
          id="cr-file"
          ref={fileRef}
          className="file-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="ac-field__hint">
          Nova reads the text in the PDF. Pages that are scans are listed, not read.
        </p>
      </div>
      <div className="form-row">
        <Select
          label="Contract type"
          value={contractType}
          onChange={(e) => setContractType(e.target.value as ContractType)}
          options={CONTRACT_TYPES}
        />
        <Select
          label="Our side"
          value={ourSide}
          onChange={(e) => setOurSide(e.target.value as OurSide)}
          options={OUR_SIDES}
        />
        <Select
          label="Base form"
          value={baseForm}
          onChange={(e) => setBaseForm(e.target.value as BaseForm | '')}
          options={BASE_FORMS}
        />
      </div>
      <p className="u-caption u-m-0">
        Jurisdiction: {project.state ?? 'not set'} (from the project).
      </p>
      <Checkbox
        label="This contract covers work in more than one state"
        checked={multiState}
        onChange={(e) => setMultiState(e.target.checked)}
      />
      {start.isPending ? (
        <Alert tone="info" title="Nova is reading the contract">
          Checking the file, then reading it against your playbook. This can take a minute.
        </Alert>
      ) : null}
      <ErrorAlert error={start.error} title="Nova couldn't review this contract" />
      <div className="row-actions">
        <Button type="submit" loading={start.isPending} disabled={!file}>
          Start review
        </Button>
        <span className="u-caption">Uses about 40 AI credits.</span>
      </div>
    </form>
  );
}
