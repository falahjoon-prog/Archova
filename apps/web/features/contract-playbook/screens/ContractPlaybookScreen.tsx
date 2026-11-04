'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
  TextField,
} from '@archova/ui';
import { CONTRACT_TYPES } from '@/features/contract-review/lib/labels';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { ContractType, PlaybookTopic } from '../data/api';
import { useContractPlaybook, useSaveContractPlaybook } from '../hooks/useContractPlaybook';
import { draftProblem, emptyTopic, toDraft, toTopics, type DraftTopic } from '../lib';

const MAX_TOPICS = 40;
const SEVERITIES = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** CR4: the company's contract playbook. Nova flags clauses that depart from it, and only ever offers the wording kept here. */
export function ContractPlaybookScreen() {
  const org = useCurrentOrg();
  const allowed = org.role === 'owner' || org.role === 'admin';
  const [contractType, setContractType] = useState<ContractType>('subcontract');
  const q = useContractPlaybook(contractType, allowed);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Contract playbook"
        description="The positions your company wants in a contract, and the wording your lawyer has approved. Nova flags clauses that depart from it. It never writes wording of its own."
      />
      {!allowed ? (
        <Alert tone="info" title="Admins only">
          The playbook is kept by company owners and admins.
        </Alert>
      ) : (
        <>
          <Select
            label="Contract type"
            value={contractType}
            onChange={(e) => setContractType(e.target.value as ContractType)}
            options={CONTRACT_TYPES}
          />
          <ErrorAlert error={q.error} title="We couldn't load the playbook" />
          {q.isPending ? <SkeletonRows label="Loading the playbook…" /> : null}
          {q.data ? <Editor key={contractType} contractType={contractType} saved={q.data} /> : null}
        </>
      )}
    </div>
  );
}

function Editor({ contractType, saved }: { contractType: ContractType; saved: PlaybookTopic[] }) {
  const save = useSaveContractPlaybook(contractType);
  const [drafts, setDrafts] = useState<DraftTopic[]>(() => saved.map(toDraft));
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);

  const change = (next: DraftTopic[]) => {
    setDrafts(next);
    setDirty(true);
  };
  const patch = (uid: string, p: Partial<DraftTopic>) =>
    change(drafts.map((d) => (d.uid === uid ? { ...d, ...p } : d)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...drafts];
    const [t] = next.splice(i, 1);
    next.splice(i + by, 0, t!);
    change(next);
  };
  const submit = () => {
    setTried(true);
    if (drafts.some(draftProblem)) return;
    save.mutate(toTopics(drafts), {
      onSuccess: (topics) => {
        setDrafts(topics.map(toDraft));
        setDirty(false);
        setTried(false);
      },
    });
  };

  return (
    <div className="stack">
      {!drafts.length ? (
        <Card>
          <EmptyState
            title="No topics yet"
            description="Until you add some, Nova has nothing to compare a contract against for this type."
          />
        </Card>
      ) : null}
      {drafts.map((d, i) => (
        <TopicCard
          key={d.uid}
          d={d}
          index={i}
          last={i === drafts.length - 1}
          problem={tried ? draftProblem(d) : null}
          onPatch={(p) => patch(d.uid, p)}
          onMove={(by) => move(i, by)}
          onRemove={() => change(drafts.filter((x) => x.uid !== d.uid))}
        />
      ))}
      <ErrorAlert error={save.error} title="We couldn't save the playbook" />
      {save.isSuccess && !dirty ? <Alert tone="success" title="Playbook saved" /> : null}
      <div className="row-actions">
        <Button
          variant="secondary"
          disabled={drafts.length >= MAX_TOPICS}
          onClick={() => change([...drafts, emptyTopic()])}
        >
          Add topic
        </Button>
        <Button loading={save.isPending} disabled={!dirty} onClick={submit}>
          Save playbook
        </Button>
        <span className="u-caption">
          {drafts.length} of {MAX_TOPICS} topics. Saving replaces the playbook for this contract
          type.
        </span>
      </div>
    </div>
  );
}

function TopicCard({
  d,
  index,
  last,
  problem,
  onPatch,
  onMove,
  onRemove,
}: {
  d: DraftTopic;
  index: number;
  last: boolean;
  problem: string | null;
  onPatch: (p: Partial<DraftTopic>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = d.topic.trim() || `Topic ${index + 1}`;
  const f = d.fallback;
  const setFallback = (p: Partial<NonNullable<DraftTopic['fallback']>>) =>
    f && onPatch({ fallback: { ...f, ...p } });
  return (
    <Card title={label}>
      <div className="stack">
        <div className="form-row">
          <TextField
            label="Topic"
            value={d.topic}
            maxLength={120}
            onChange={(e) => onPatch({ topic: e.target.value })}
          />
          <Select
            label="How serious a departure is"
            value={d.severity}
            onChange={(e) => onPatch({ severity: e.target.value as DraftTopic['severity'] })}
            options={SEVERITIES}
          />
          <TextField
            label="Limit (optional)"
            hint="For example 10% or 28 days"
            value={d.threshold}
            maxLength={120}
            onChange={(e) => onPatch({ threshold: e.target.value })}
          />
        </div>
        <Textarea
          label="Our position"
          hint="What you want, in your words."
          value={d.position}
          maxLength={600}
          onChange={(e) => onPatch({ position: e.target.value })}
        />
        {f ? (
          <div className="stack">
            <p className="u-caption u-m-0">
              Approved wording. Nova stops offering it after the review date.
            </p>
            <TextField
              label="Wording title"
              value={f.title}
              maxLength={160}
              onChange={(e) => setFallback({ title: e.target.value })}
            />
            <Textarea
              label="Approved wording"
              rows={6}
              value={f.wording}
              maxLength={4000}
              onChange={(e) => setFallback({ wording: e.target.value })}
            />
            <div className="form-row">
              <TextField
                label="Approved by"
                value={f.approvedBy}
                maxLength={160}
                onChange={(e) => setFallback({ approvedBy: e.target.value })}
              />
              <TextField
                label="Approved on"
                type="date"
                value={f.approvedOn}
                onChange={(e) => setFallback({ approvedOn: e.target.value })}
              />
              <TextField
                label="Review by (optional)"
                type="date"
                value={f.reviewBy}
                onChange={(e) => setFallback({ reviewBy: e.target.value })}
              />
            </div>
            <div>
              <Button variant="tertiary" size="sm" onClick={() => onPatch({ fallback: null })}>
                Remove approved wording
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onPatch({
                  fallback: {
                    title: '',
                    wording: '',
                    approvedBy: '',
                    approvedOn: '',
                    reviewBy: '',
                  },
                })
              }
            >
              Add approved wording
            </Button>
          </div>
        )}
        {problem ? (
          <Alert tone="danger" title="Fix this topic before saving">
            {problem}
          </Alert>
        ) : null}
        <div className="row-actions">
          <Button
            variant="tertiary"
            size="sm"
            disabled={index === 0}
            aria-label={`Move ${label} up`}
            onClick={() => onMove(-1)}
          >
            Move up
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            disabled={last}
            aria-label={`Move ${label} down`}
            onClick={() => onMove(1)}
          >
            Move down
          </Button>
          <Button variant="danger" size="sm" aria-label={`Remove ${label}`} onClick={onRemove}>
            Remove topic
          </Button>
        </div>
      </div>
    </Card>
  );
}
