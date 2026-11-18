'use client';

import { useState, type FormEvent } from 'react';
import { Button, Dialog, Select, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import type { ProjectRisk, RiskCategory, RiskStatus } from '../data/api';
import { useRiskMutations } from '../hooks/useRisks';
import {
  CATEGORY_LABELS,
  IMPACT_WORDS,
  LIKELIHOOD_WORDS,
  SCALE,
  STATUS_LABELS,
} from '../lib/labels';

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const scale = (words: string[]) =>
  SCALE.map((n) => ({ value: String(n), label: `${n} ${words[n - 1]}` }));

/** Add a risk, or edit one. Score and level are worked out by the server from likelihood and impact. */
export function RiskDialog({
  open,
  onClose,
  risk,
}: {
  open: boolean;
  onClose: () => void;
  risk: ProjectRisk | null;
}) {
  const { create, update } = useRiskMutations();
  const mutation = risk ? update : create;
  const [title, setTitle] = useState(risk?.title ?? '');
  const [description, setDescription] = useState(risk?.description ?? '');
  const [category, setCategory] = useState<RiskCategory>(risk?.category ?? 'cost');
  const [likelihood, setLikelihood] = useState(String(risk?.likelihood ?? 3));
  const [impact, setImpact] = useState(String(risk?.impact ?? 3));
  const [status, setStatus] = useState<RiskStatus>(risk?.status ?? 'open');
  const [ownerName, setOwnerName] = useState(risk?.ownerName ?? '');
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? '');
  const [reviewDate, setReviewDate] = useState(risk?.reviewDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const server = serverFieldErrors(mutation.error);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Give the risk a short title.');
    setError(null);
    const body = {
      title: title.trim(),
      description: description.trim(),
      category,
      likelihood: Number(likelihood),
      impact: Number(impact),
      status,
      ownerName: ownerName.trim() || null,
      mitigation: mitigation.trim(),
      reviewDate: reviewDate || null,
    };
    const done = { onSuccess: onClose };
    if (risk) update.mutate({ risk: { id: risk.id, version: risk.version }, body }, done);
    else create.mutate(body, done);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={risk ? `Edit R-${risk.number}` : 'Add a risk'}
      description="Score it by how likely it is and how bad it would be. Closed risks stop counting towards the project's risk colour."
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="risk-form" loading={mutation.isPending}>
            {risk ? 'Save risk' : 'Add risk'}
          </Button>
        </>
      }
    >
      <form id="risk-form" className="stack" onSubmit={submit} noValidate>
        <ErrorAlert error={mutation.error} title="We couldn't save the risk" />
        <TextField
          label="Title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          error={error ?? server.title}
        />
        <Textarea
          label="What could happen"
          value={description}
          maxLength={4000}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Select
          label="Category"
          options={options(CATEGORY_LABELS)}
          value={category}
          onChange={(e) => setCategory(e.target.value as RiskCategory)}
        />
        <Select
          label="Likelihood"
          options={scale(LIKELIHOOD_WORDS)}
          value={likelihood}
          onChange={(e) => setLikelihood(e.target.value)}
        />
        <Select
          label="Impact"
          options={scale(IMPACT_WORDS)}
          value={impact}
          onChange={(e) => setImpact(e.target.value)}
        />
        <Select
          label="Status"
          options={options(STATUS_LABELS)}
          value={status}
          onChange={(e) => setStatus(e.target.value as RiskStatus)}
        />
        <TextField
          label="Owner"
          hint="Who is managing it."
          value={ownerName}
          maxLength={120}
          onChange={(e) => setOwnerName(e.target.value)}
        />
        <Textarea
          label="Mitigation"
          value={mitigation}
          maxLength={4000}
          rows={3}
          onChange={(e) => setMitigation(e.target.value)}
        />
        <TextField
          label="Review by"
          type="date"
          value={reviewDate}
          onChange={(e) => setReviewDate(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
