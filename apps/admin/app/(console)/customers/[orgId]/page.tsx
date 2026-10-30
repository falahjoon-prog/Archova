'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DescriptionList,
  FormError,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { SUSPEND_CATEGORIES, type OrgDetailDto, type SuspendCategory } from '@archova/contracts';
import { ApiError, api } from '@/shared/api';
import { OrgActionDialog } from '@/shared/OrgActionDialog';
import { useStepUp } from '@/shared/StepUp';
import { can, useStaff } from '@/shared/staff';
import {
  STATUS_LABEL,
  formatDate,
  formatDateTime,
  planStateLabel,
  statusTone,
} from '@/shared/format';

type Dialogue = 'trial' | 'plan' | 'suspend' | 'reactivate' | null;
const PLAN_OPTIONS = [
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'team', label: 'Team' },
  { value: 'business', label: 'Business' },
  { value: 'enterprise', label: 'Enterprise' },
];
const CATEGORY_LABEL: Record<SuspendCategory, string> = {
  abuse: 'Abuse',
  fraud: 'Fraud',
  security: 'Security emergency',
  legal_order: 'Legal order',
};

const SUPPORT_TONE = {
  active: 'success',
  open: 'success',
  expired: 'neutral',
  ended: 'neutral',
  revoked: 'warning',
} as const;

function SupportAccess({ orgId }: { orgId: string }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const [ticket, setTicket] = useState('');
  const [error, setError] = useState<string | null>(null);
  const access = useQuery({
    queryKey: ['support-access', orgId],
    queryFn: () => api.supportAccess(orgId),
  });
  const canStart = can(staff, 'backoffice.support.access');
  const refresh = (fresh: Awaited<ReturnType<typeof api.supportAccess>>) => {
    qc.setQueryData(['support-access', orgId], fresh);
    setError(null);
  };
  const start = useMutation({
    mutationFn: () => withStepUp(() => api.startSupportSession(orgId, ticket.trim())),
    onSuccess: (fresh) => {
      refresh(fresh);
      setTicket('');
    },
    onError: (e: Error) => setError(e.message),
  });
  const end = useMutation({
    mutationFn: (id: string) => api.endSupportSession(orgId, id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const activeGrant = access.data?.grants.find((g) => g.status === 'active');
  const open = access.data?.sessions.find((s) => s.status === 'open');

  return (
    <Card title="Support access">
      {access.isPending ? <SkeletonRows rows={2} /> : null}
      {access.isError ? <Alert tone="danger">{access.error.message}</Alert> : null}
      {access.data ? (
        <div className="stack">
          <p className="muted">
            Off unless the company's owner or admin grants it. A grant is view-only, tied to a
            ticket and lasts up to 72 hours; a session lasts up to an hour. Staff cannot see project
            content from this console.
          </p>
          {access.data.grants.length === 0 ? (
            <p>No grant. This company has not given Archova support access.</p>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {access.data.grants.slice(0, 5).map((g) => (
                <li key={g.id} className="row">
                  <StatusPill tone={SUPPORT_TONE[g.status]}>{g.status}</StatusPill>
                  <span>
                    Ticket {g.ticketRef}{' '}
                    <span className="muted">
                      · granted by {g.grantedBy} · until {formatDateTime(g.expiresAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {access.data.sessions.length ? (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {access.data.sessions.slice(0, 5).map((s) => (
                <li key={s.id} className="row">
                  <StatusPill tone={SUPPORT_TONE[s.status]}>{`session ${s.status}`}</StatusPill>
                  <span>
                    {s.staffName}{' '}
                    <span className="muted">
                      · {s.ticketRef} · {formatDateTime(s.startedAt)}
                    </span>
                  </span>
                  {s.status === 'open' && canStart ? (
                    <Button variant="tertiary" size="sm" onClick={() => end.mutate(s.id)}>
                      End session
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canStart && activeGrant && !open ? (
            <div className="row">
              <TextField
                label="Ticket reference"
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                hint={`Must match the grant's ticket (${activeGrant.ticketRef}).`}
              />
              <Button
                onClick={() => start.mutate()}
                loading={start.isPending}
                disabled={ticket.trim().length < 2}
              >
                Start session
              </Button>
            </div>
          ) : null}
          <FormError message={error} />
        </div>
      ) : null}
    </Card>
  );
}

function AccountActions({ org }: { org: OrgDetailDto }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const [open, setOpen] = useState<Dialogue>(null);
  const [days, setDays] = useState('30');
  const [planCode, setPlanCode] = useState('team');
  const [category, setCategory] = useState<SuspendCategory>('abuse');
  const suspended = Boolean(org.account?.suspended);
  const onTrial = (org.account?.plan ?? org.plan) === 'trial';
  const d = Number(days);
  const daysOk = Number.isInteger(d) && d >= 1 && d <= 30;
  const done = (fresh: OrgDetailDto) => {
    qc.setQueryData(['org', org.orgId], fresh);
    void qc.invalidateQueries({ queryKey: ['orgs'] });
  };
  const close = () => setOpen(null);

  const canTrial = can(staff, 'backoffice.accounts.trial') && onTrial && !suspended;
  const canPlan = can(staff, 'backoffice.accounts.plan') && !suspended;
  const canSuspend = can(staff, 'backoffice.accounts.suspend');
  if (!canTrial && !canPlan && !canSuspend) return null;

  return (
    <Card title="Actions">
      <div className="row">
        {canTrial ? (
          <Button variant="secondary" onClick={() => setOpen('trial')}>
            Extend trial
          </Button>
        ) : null}
        {canPlan ? (
          <Button variant="secondary" onClick={() => setOpen('plan')}>
            Change plan
          </Button>
        ) : null}
        {canSuspend && !suspended ? (
          <Button variant="danger" onClick={() => setOpen('suspend')}>
            Suspend
          </Button>
        ) : null}
        {canSuspend && suspended ? (
          <Button onClick={() => setOpen('reactivate')}>Reactivate</Button>
        ) : null}
      </div>
      <OrgActionDialog
        open={open === 'trial'}
        title="Extend the trial"
        description="One extension is up to 30 days. Support and Sales can extend to 120 days in total; beyond that needs an Owner."
        confirmLabel="Extend trial"
        fields={
          <TextField
            label="Days to add"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            error={daysOk ? undefined : 'A whole number from 1 to 30'}
          />
        }
        onClose={close}
        onConfirm={async (i) => {
          if (!daysOk) throw new Error('Days must be a whole number from 1 to 30.');
          done(await api.trialExtend(org.orgId, { days: d, ...i }));
        }}
      />
      <OrgActionDialog
        open={open === 'plan'}
        title="Change plan"
        description="An upgrade takes effect at once and changes what this company can use. A downgrade happens at the end of the term, not from here."
        confirmLabel="Change plan"
        fields={
          <Select
            label="Plan"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            options={PLAN_OPTIONS}
          />
        }
        onClose={close}
        onConfirm={async (i) =>
          done(await withStepUp(() => api.changePlan(org.orgId, { planCode, ...i })))
        }
      />
      <OrgActionDialog
        open={open === 'suspend'}
        title="Suspend this company"
        description="Only for abuse, fraud, a security emergency or a legal order, never for non-payment. The company becomes read-only and its owners can still export their data."
        confirmLabel="Suspend"
        danger
        fields={
          <Select
            label="Reason category"
            value={category}
            onChange={(e) => setCategory(e.target.value as SuspendCategory)}
            options={SUSPEND_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
        }
        onClose={close}
        onConfirm={async (i) =>
          done(await withStepUp(() => api.suspend(org.orgId, { category, ...i })))
        }
      />
      <OrgActionDialog
        open={open === 'reactivate'}
        title="Reactivate this company"
        description="Lifts the suspension so the company can write again."
        confirmLabel="Reactivate"
        onClose={close}
        onConfirm={async (i) => done(await withStepUp(() => api.reactivate(org.orgId, i)))}
      />
    </Card>
  );
}

export default function CustomerPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => api.org(orgId) });

  if (org.isPending) return <SkeletonRows rows={5} />;
  if (org.isError)
    return (
      <>
        <PageHeader title="Customer" />
        <Alert
          tone="danger"
          title={
            org.error instanceof ApiError && org.error.status === 404
              ? 'No such customer'
              : 'Could not load this customer'
          }
        >
          {org.error.message}{' '}
          <Link className="link" href="/customers">
            Back to customers
          </Link>
        </Alert>
      </>
    );
  const o = org.data;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link className="link" href="/customers">
            Customers
          </Link>
        }
        title={o.name}
        actions={
          <StatusPill
            tone={o.state === 'active' ? 'success' : o.state === 'suspended' ? 'danger' : 'info'}
          >
            {planStateLabel(o.state)}
          </StatusPill>
        }
      />
      <Card title="Account">
        <DescriptionList
          items={[
            { label: 'Web address', value: o.slug, mono: true },
            { label: 'Plan', value: o.plan },
            { label: 'Seats', value: o.seats ?? '—' },
            { label: 'Trial ends', value: formatDate(o.trialEndsAt) },
            ...(o.account?.suspended
              ? [
                  {
                    label: 'Suspended',
                    value: `${CATEGORY_LABEL[o.account.suspended.category]}, ${formatDate(o.account.suspended.at)}`,
                  },
                ]
              : []),
            { label: 'Created', value: formatDate(o.createdAt) },
            { label: 'Organisation id', value: o.orgId, mono: true },
          ]}
        />
      </Card>
      <AccountActions org={o} />
      <SupportAccess orgId={o.orgId} />
      <Card title="Staff actions on this customer">
        {o.actions.length ? (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {o.actions.map((a) => (
              <li key={a.id}>
                {a.summary}{' '}
                <span className="muted">
                  · {a.by} · {formatDateTime(a.at)} · {a.ticketRef}
                </span>
                <br />
                <span className="muted">Reason: {a.reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {o.history.length ? (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {o.history.map((r) => (
              <li key={r.id} className="row">
                <StatusPill tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</StatusPill>
                <span>
                  {r.subject}{' '}
                  <span className="muted">
                    · {r.requestedBy.name} · {formatDateTime(r.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : o.actions.length ? null : (
          <p className="muted">No staff action has been taken on this customer.</p>
        )}
      </Card>
    </>
  );
}
