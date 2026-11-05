'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Inbox } from '@archova/ui/icons';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
} from '@archova/ui';
import type {
  PlanVersionDto,
  PriceBookPreview,
  RequestDto,
  RequestStatus,
} from '@archova/contracts';
import { api } from '@/shared/api';
import { PriceChanges } from '@/shared/PriceChanges';
import { ReasonDialog } from '@/shared/ReasonDialog';
import { useStepUp } from '@/shared/StepUp';
import { can, useStaff } from '@/shared/staff';
import {
  REQUEST_STATUS_OPTIONS,
  STATUS_LABEL,
  formatDateTime,
  formatMoney,
  statusTone,
} from '@/shared/format';

const FIELDS: Array<[keyof PlanVersionDto, string]> = [
  ['name', 'Name'],
  ['blurb', 'Summary'],
  ['features', 'Features'],
  ['modules', 'Modules'],
  ['aiCreditsMonthly', 'Nova credits a month'],
  ['ctaLabel', 'Button label'],
  ['ctaHref', 'Button link'],
];
const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') || '—' : v === null || v === undefined ? '—' : String(v);

function PlanDiff({ draft, live }: { draft: PlanVersionDto; live: PlanVersionDto | null }) {
  const changed = FIELDS.filter(([k]) => !live || show(live[k]) !== show(draft[k]));
  if (!changed.length) return <p className="muted">No visible change.</p>;
  return (
    <dl className="ac-dl">
      {changed.map(([k, label]) => (
        <div key={k} className="ac-dl__row">
          <dt>{label}</dt>
          <dd>
            {live ? (
              <>
                <span className="muted">{show(live[k])}</span> → {show(draft[k])}
              </>
            ) : (
              show(draft[k])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Preview({ r }: { r: RequestDto }) {
  const p = r.preview;
  if (!p) return null;
  if (r.kind === 'pricebook.publish') {
    const preview = p as unknown as PriceBookPreview;
    return (
      <>
        <PriceChanges changes={preview.changes} />
        {preview.hasIncrease ? (
          <p className="muted">
            This raises a price, so customers get 60 days' notice before it takes effect.
          </p>
        ) : null}
      </>
    );
  }
  if (r.kind === 'refund')
    return (
      <p>
        <strong>{formatMoney(Number(p.amountCents))}</strong> back on invoice{' '}
        <span className="mono">{String(p.invoiceRef)}</span>, which collected{' '}
        {formatMoney(Number(p.paidCents))}. Ticket {String(p.ticketRef)}.
      </p>
    );
  const draft = p.draft as PlanVersionDto | null;
  return draft ? <PlanDiff draft={draft} live={(p.live as PlanVersionDto | null) ?? null} /> : null;
}

function outcomeMessage(r: RequestDto): string {
  if (r.kind === 'refund') {
    if (r.status === 'executed')
      return `${r.subject} is approved. It is recorded for payment; no money moves from here.`;
    if (r.status === 'failed')
      return `${r.subject} could not be applied: ${String(r.result?.error ?? 'unknown error')}`;
    return `${r.subject} was ${r.status === 'rejected' ? 'rejected' : 'cancelled'} and is not owed.`;
  }
  if (r.status === 'executed')
    return r.result?.outcome === 'scheduled'
      ? `${r.subject} is approved and scheduled for its effective date.`
      : `${r.subject} is approved and live.`;
  if (r.status === 'failed')
    return `${r.subject} could not be applied: ${String(r.result?.error ?? 'unknown error')}`;
  if (r.status === 'rejected') return `${r.subject} was rejected and is back in draft.`;
  return `${r.subject} was cancelled and is back in draft.`;
}

function RequestCard({ r, onDone }: { r: RequestDto; onDone: (message: string) => void }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['price-books'] });
    void qc.invalidateQueries({ queryKey: ['plans'] });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<RequestDto>) => fn(),
    onSuccess: (done) => {
      refresh();
      onDone(outcomeMessage(done));
    },
    onError: (e: Error) => setError(e.message),
  });

  const mine = r.requestedBy.id === staff.id;
  const waiting = r.coolingOffUntil && new Date(r.coolingOffUntil) > new Date();
  const decide =
    can(staff, 'backoffice.requests.decide') &&
    (r.kind !== 'refund' || can(staff, 'backoffice.accounts.refund_approve')) &&
    r.status === 'pending';
  const canApprove = decide && (!mine || r.coolingOffUntil !== null);
  const canCancel = r.status === 'pending' && (mine || staff.roles.includes('owner'));

  return (
    <Card>
      <div className="request">
        <div className="request__head">
          <div>
            <p className="request__title">{r.subject}</p>
            <p className="request__meta">
              Proposed by {r.requestedBy.name} · {formatDateTime(r.createdAt)}
            </p>
          </div>
          <StatusPill tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</StatusPill>
        </div>
        <p>
          <span className="muted">Reason: </span>
          {r.reason}
        </p>
        <Preview r={r} />
        {r.status === 'executed' && r.result ? (
          <p className="muted">
            {r.approvedBy ? `Approved by ${r.approvedBy.name}. ` : ''}
            {r.kind === 'refund'
              ? 'Recorded for payment.'
              : r.result.outcome === 'scheduled'
                ? 'Scheduled for its effective date.'
                : 'Now live.'}
          </p>
        ) : null}
        {r.status === 'failed' ? (
          <Alert tone="danger" title="Could not apply">
            {String(r.result?.error ?? 'Unknown error')}{' '}
            {r.kind === 'refund' ? 'The refund is not owed.' : 'The change is back in draft.'}
          </Alert>
        ) : null}
        {r.status === 'pending' && mine && !r.coolingOffUntil ? (
          <Alert tone="info">
            A second person has to approve this. You can cancel it
            {r.kind === 'refund' ? '' : ' to keep editing'}.
          </Alert>
        ) : null}
        {r.status === 'pending' && mine && waiting ? (
          <Alert tone="warning" title="Solo-owner delay">
            You are the only approver, so you can approve your own change from{' '}
            {formatDateTime(r.coolingOffUntil)}.
          </Alert>
        ) : null}
        <FormErrorLine message={error} />
        {r.status === 'pending' ? (
          <div className="row row--end">
            {canCancel ? (
              <Button
                variant="tertiary"
                onClick={() => run.mutate(() => api.cancel(r.id))}
                loading={run.isPending}
              >
                Cancel request
              </Button>
            ) : null}
            {decide && !mine ? (
              <Button variant="secondary" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                disabled={Boolean(mine && waiting)}
                onClick={() => run.mutate(() => withStepUp(() => api.approve(r.id)))}
                loading={run.isPending}
              >
                Approve and publish
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ReasonDialog
        open={rejecting}
        title="Reject this change?"
        description="The proposer gets it back as a draft to change."
        confirmLabel="Reject"
        danger
        onClose={() => setRejecting(false)}
        onConfirm={async (reason) => {
          const done = await api.reject(r.id, reason);
          refresh();
          onDone(outcomeMessage(done));
        }}
      />
    </Card>
  );
}

const FormErrorLine = ({ message }: { message: string | null }) =>
  message ? <Alert tone="danger">{message}</Alert> : null;

export default function ApprovalsPage() {
  const [status, setStatus] = useState<RequestStatus>('pending');
  const [notice, setNotice] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['requests', status],
    queryFn: () => api.requests({ status, limit: 50 }),
  });
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Price and plan changes go live only after a second person approves them."
      />
      <FilterBar label="Filter requests">
        <Select
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value as RequestStatus)}
          options={REQUEST_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </FilterBar>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {list.isError ? (
        <Alert tone="danger" title="Could not load requests">
          {list.error.message}
        </Alert>
      ) : list.isPending ? (
        <SkeletonRows rows={4} />
      ) : list.data.items.length ? (
        <div className="stack">
          {list.data.items.map((r) => (
            <RequestCard key={r.id} r={r} onDone={setNotice} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Inbox}
          title={status === 'pending' ? 'Nothing is waiting for approval' : 'Nothing to show'}
          description="Propose a change from Plans or Price book."
        />
      )}
    </>
  );
}
