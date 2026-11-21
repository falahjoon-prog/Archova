'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, DescriptionList, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentClaimDetail, RecordClaimAdjudication } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { aud } from '../lib/money';

type Record = NonNullable<PaymentClaimDetail['adjudication']>;
type Form = { [K in keyof RecordClaimAdjudication]-?: string };

const OUTCOMES = [
  { value: 'upheld', label: 'Upheld in full' },
  { value: 'part_upheld', label: 'Upheld in part' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'settled', label: 'Settled' },
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label]));

const blank: Form = {
  noticeServedOn: '',
  applicationLodgedOn: '',
  nominatingAuthority: '',
  adjudicatorName: '',
  adjudicatorAppointedOn: '',
  responseDueOn: '',
  responseLodgedOn: '',
  determinationDueOn: '',
  determinedOn: '',
  adjudicatedAmount: '',
  outcome: '',
  notes: '',
};
const fromRecord = (r: Record | null): Form =>
  r
    ? (Object.fromEntries(
        Object.keys(blank).map((k) => [
          k,
          (r as unknown as { [k: string]: string | null })[k] ?? '',
        ]),
      ) as Form)
    : blank;

/**
 * What happened once adjudication began on this claim. Staff type in the dates from the notices they send and
 * receive; nothing here is calculated or chosen for them. The response and determination due dates come from the
 * adjudicator's own notice. The steps that follow show on the claim timeline above.
 */
export function AdjudicationCard({
  detail,
  canRecord,
}: {
  detail: PaymentClaimDetail;
  canRecord: boolean;
}) {
  const project = useCurrentProject();
  const { recordAdjudication } = useClaimsMutations(project.projectId);
  const r = detail.adjudication ?? null;
  const relevant = r !== null || detail.timeline.some((s) => s.key.startsWith('adjudication_'));
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(fromRecord(r));
  const [error, setError] = useState<string | null>(null);
  if (!relevant) return null;

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.adjudicatedAmount.trim() && !/^\d+(\.\d{1,2})?$/.test(form.adjudicatedAmount.trim()))
      return setError('Enter the adjudicated amount as dollars, like 12500.00.');
    const body = Object.fromEntries(
      Object.entries(form)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v !== ''),
    ) as RecordClaimAdjudication;
    recordAdjudication.mutate(
      { claimId: detail.claim.id, body },
      { onSuccess: () => setEditing(false) },
    );
  }

  const date = (v: string | null) => (v ? formatLocalDate(v) : '—');
  const field = (k: keyof Form, label: string, type: 'date' | 'text' = 'date', hint?: string) => (
    <TextField label={label} type={type} value={form[k]} hint={hint} onChange={set(k)} />
  );

  return (
    <Card title="Adjudication record">
      {r && !editing ? (
        <DescriptionList
          items={[
            { label: 'Notice of intention served', value: date(r.noticeServedOn) },
            { label: 'Application lodged', value: date(r.applicationLodgedOn) },
            { label: 'Nominating authority', value: r.nominatingAuthority ?? '—' },
            { label: 'Adjudicator', value: r.adjudicatorName ?? '—' },
            { label: 'Adjudicator appointed', value: date(r.adjudicatorAppointedOn) },
            { label: 'Response due (adjudicator’s notice)', value: date(r.responseDueOn) },
            { label: 'Response lodged', value: date(r.responseLodgedOn) },
            {
              label: 'Determination due (adjudicator’s notice)',
              value: date(r.determinationDueOn),
            },
            { label: 'Determined', value: date(r.determinedOn) },
            { label: 'Outcome', value: r.outcome ? OUTCOME_LABEL[r.outcome] : '—' },
            {
              label: 'Adjudicated amount',
              value: r.adjudicatedAmount ? aud(r.adjudicatedAmount) : '—',
              mono: true,
            },
            ...(r.notes ? [{ label: 'Notes', value: r.notes }] : []),
          ]}
        />
      ) : null}
      {!r && !editing ? (
        <p>
          Nothing recorded yet. Once a notice is served or an application is lodged, record the
          dates here and the claim timeline will follow them.
        </p>
      ) : null}
      {canRecord && !editing ? (
        <div className="row-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setForm(fromRecord(r));
              setEditing(true);
            }}
          >
            {r ? 'Update the record' : 'Record adjudication'}
          </Button>
        </div>
      ) : null}
      {canRecord && editing ? (
        <form className="stack-lg" onSubmit={save} noValidate>
          {field('noticeServedOn', 'Notice of intention served on')}
          {field('applicationLodgedOn', 'Application lodged on')}
          {field('nominatingAuthority', 'Authorised nominating authority', 'text')}
          {field('adjudicatorName', 'Adjudicator', 'text')}
          {field('adjudicatorAppointedOn', 'Adjudicator appointed on')}
          {field('responseDueOn', 'Response due on', 'date', 'From the adjudicator’s notice.')}
          {field('responseLodgedOn', 'Response lodged on')}
          {field(
            'determinationDueOn',
            'Determination due on',
            'date',
            'From the adjudicator’s notice.',
          )}
          {field('determinedOn', 'Determined on')}
          <Select
            label="Outcome"
            placeholder="Not decided yet"
            options={OUTCOMES}
            value={form.outcome}
            onChange={set('outcome')}
          />
          {field('adjudicatedAmount', 'Adjudicated amount', 'text', 'Dollars, like 12500.00.')}
          <TextField
            label="Notes (optional)"
            value={form.notes}
            maxLength={2000}
            onChange={set('notes')}
          />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ErrorAlert error={recordAdjudication.error} title="We couldn’t save the record" />
          <div className="row-actions">
            <Button type="submit" disabled={recordAdjudication.isPending}>
              {recordAdjudication.isPending ? 'Saving…' : 'Save record'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
