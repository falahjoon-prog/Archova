'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { OwnerPortalIcon } from '@archova/ui/icons';
import { atLeast } from '@archova/domain/permissions';
import { useProjectPermissions } from '@/features/projects';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, formatMoney, formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Approval, CapitalPlan, ProgressUpdate } from '../data/api';
import {
  useApprovals,
  useCapitalPlan,
  useOwnerPortalMutations,
  useProgressUpdates,
} from '../hooks/useOwnerPortal';

const TABS = [
  { id: 'progress', label: 'Progress' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'capital', label: 'Capital plan' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const money = (cents: number) =>
  formatMoney({
    amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
    currency: 'AUD',
  });

/** Dollars typed by a person to whole cents; null when blank or not a non-negative number. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const MILESTONE_LABEL = {
  done: 'Done',
  on_track: 'On track',
  at_risk: 'At risk',
  late: 'Late',
} as const;
const MILESTONE_TONE: Record<keyof typeof MILESTONE_LABEL, StatusTone> = {
  done: 'success',
  on_track: 'info',
  at_risk: 'warning',
  late: 'danger',
};
const APPROVAL_LABEL: Record<Approval['status'], string> = {
  requested: 'Waiting for the client',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
const APPROVAL_TONE: Record<Approval['status'], StatusTone> = {
  requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

/** What the owner or client sees of a project: progress, decisions asked of them, and the capital plan. */
export function OwnerPortalScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  // UI gating only; the API enforces every key.
  const p = perms.data;
  const admin = p?.orgRole === 'owner' || p?.orgRole === 'admin';
  const isTeam = !!p && (admin || atLeast(p.toolLevels.owner_portal, 'standard'));
  const canDecide = !!p && (admin || p.granular.includes('ownerportal.approvals.decide'));
  const [params, setParams] = useUrlState(['tab'] as const);
  const tab: TabId = TABS.some((t) => t.id === params.tab) ? (params.tab as TabId) : 'progress';

  return (
    <>
      <PageHeader
        eyebrow="Owner portal"
        title={project.name}
        description="Progress the builder has published, decisions waiting on the client, and the capital plan."
      />
      <Tabs
        label="Owner portal"
        tabs={TABS}
        value={tab}
        onValueChange={(id) => setParams({ tab: id === 'progress' ? '' : id })}
      >
        {tab === 'progress' ? <ProgressTab isTeam={isTeam} /> : null}
        {tab === 'approvals' ? <ApprovalsTab isTeam={isTeam} canDecide={canDecide} /> : null}
        {tab === 'capital' ? <CapitalTab isTeam={isTeam} /> : null}
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------- progress

function ProgressTab({ isTeam }: { isTeam: boolean }) {
  const list = useProgressUpdates();
  const m = useOwnerPortalMutations();
  const [adding, setAdding] = useState(false);
  const data = list.data ?? [];
  return (
    <div className="stack">
      {isTeam ? (
        <div className="u-row">
          <Button onClick={() => setAdding(true)}>New progress update</Button>
        </div>
      ) : null}
      <ErrorAlert error={list.error} title="We couldn't load progress updates" />
      <ErrorAlert error={m.publishUpdate.error} title="We couldn't publish this update" />
      {list.isPending ? (
        <SkeletonRows label="Loading progress updates…" />
      ) : data.length === 0 ? (
        <EmptyState
          icon={OwnerPortalIcon}
          title="No progress updates yet"
          description={
            isTeam
              ? 'Write an update and publish it when it is ready for the client.'
              : 'The builder has not published an update yet.'
          }
        />
      ) : (
        data.map((u) => (
          <UpdateCard
            key={u.id}
            update={u}
            canPublish={isTeam}
            publishing={m.publishUpdate.isPending}
            onPublish={() => m.publishUpdate.mutate(u.id)}
          />
        ))
      )}
      {adding ? <UpdateDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function UpdateCard({
  update: u,
  canPublish,
  publishing,
  onPublish,
}: {
  update: ProgressUpdate;
  canPublish: boolean;
  publishing: boolean;
  onPublish: () => void;
}) {
  const project = useCurrentProject();
  return (
    <Card
      title={u.title}
      actions={
        u.status === 'draft' ? (
          <>
            <StatusPill tone="neutral">Draft, not visible to the client</StatusPill>
            {canPublish ? (
              <Button
                variant="secondary"
                disabled={publishing}
                aria-label={`Publish ${u.title}`}
                onClick={onPublish}
              >
                Publish
              </Button>
            ) : null}
          </>
        ) : (
          <StatusPill tone="success">
            Published{u.publishedAt ? ` ${formatInstant(u.publishedAt, project.timezone)}` : ''}
          </StatusPill>
        )
      }
    >
      <div className="stack">
        <p className="u-caption">
          {formatLocalDate(u.periodStart)} to {formatLocalDate(u.periodEnd)}
        </p>
        <div>
          <progress
            max={100}
            value={u.percentComplete}
            aria-label={`${u.title} percent complete`}
            style={{ width: '100%' }}
          />
          <p>{u.percentComplete}% complete</p>
        </div>
        {u.summary ? <p style={{ whiteSpace: 'pre-wrap' }}>{u.summary}</p> : null}
        {u.milestones.length > 0 ? (
          <DataTable
            caption={`Milestones for ${u.title}`}
            columns={
              [
                {
                  id: 'name',
                  header: 'Milestone',
                  rowHeader: true,
                  cell: (x) => x.name,
                },
                {
                  id: 'date',
                  header: 'Date',
                  cell: (x) => (x.date ? formatLocalDate(x.date) : '—'),
                },
                {
                  id: 'status',
                  header: 'Status',
                  cell: (x) => (
                    <StatusPill tone={MILESTONE_TONE[x.status]}>
                      {MILESTONE_LABEL[x.status]}
                    </StatusPill>
                  ),
                },
              ] satisfies DataTableColumn<ProgressUpdate['milestones'][number]>[]
            }
            rows={u.milestones}
            getRowId={(x) => x.name}
          />
        ) : null}
      </div>
    </Card>
  );
}

function UpdateDialog({ onClose }: { onClose: () => void }) {
  const m = useOwnerPortalMutations();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [percent, setPercent] = useState('');
  const [summary, setSummary] = useState('');
  const pct = Number(percent);
  const valid =
    title.trim() !== '' &&
    start !== '' &&
    end !== '' &&
    end >= start &&
    percent !== '' &&
    Number.isInteger(pct) &&
    pct >= 0 &&
    pct <= 100;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    m.createUpdate.mutate(
      {
        title: title.trim(),
        periodStart: start,
        periodEnd: end,
        percentComplete: pct,
        summary: summary.trim(),
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="New progress update"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="update-form" disabled={!valid || m.createUpdate.isPending}>
            {m.createUpdate.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </>
      }
    >
      <form id="update-form" className="stack" onSubmit={submit}>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Period start"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <TextField
          label="Period end"
          type="date"
          value={end}
          error={end && start && end < start ? 'The period ends before it starts' : undefined}
          onChange={(e) => setEnd(e.target.value)}
        />
        <TextField
          label="Percent complete"
          inputMode="numeric"
          value={percent}
          hint="Whole number from 0 to 100"
          onChange={(e) => setPercent(e.target.value)}
        />
        <Textarea
          label="Summary for the client"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <ErrorAlert error={m.createUpdate.error} title="We couldn't save this update" />
      </form>
    </Dialog>
  );
}

// --------------------------------------------------------------- approvals

function ApprovalsTab({ isTeam, canDecide }: { isTeam: boolean; canDecide: boolean }) {
  const list = useApprovals();
  const m = useOwnerPortalMutations();
  const project = useCurrentProject();
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<Approval | null>(null);
  const data = list.data ?? [];

  const columns: DataTableColumn<Approval>[] = [
    { id: 'number', header: 'No.', rowHeader: true, cell: (a) => `#${a.number}` },
    {
      id: 'title',
      header: 'Request',
      cell: (a) => (
        <>
          {a.title}
          {a.description ? <span className="u-caption"> · {a.description}</span> : null}
        </>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'end',
      cell: (a) => (a.amountCents === null ? '—' : money(a.amountCents)),
    },
    { id: 'due', header: 'Due', cell: (a) => (a.dueDate ? formatLocalDate(a.dueDate) : '—') },
    {
      id: 'status',
      header: 'Status',
      cell: (a) => (
        <>
          <StatusPill tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status]}</StatusPill>
          {a.decidedAt ? (
            <span className="u-caption"> · {formatInstant(a.decidedAt, project.timezone)}</span>
          ) : null}
          {a.decisionNote ? <span className="u-caption"> · {a.decisionNote}</span> : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (a) =>
        a.status !== 'requested' ? (
          '—'
        ) : (
          <span className="u-row">
            {canDecide ? (
              <Button
                variant="tertiary"
                aria-label={`Decide ${a.title}`}
                onClick={() => {
                  m.decide.reset();
                  setDeciding(a);
                }}
              >
                Decide
              </Button>
            ) : null}
            {isTeam ? (
              <Button
                variant="tertiary"
                aria-label={`Withdraw ${a.title}`}
                disabled={m.withdraw.isPending}
                onClick={() => m.withdraw.mutate(a.id)}
              >
                Withdraw
              </Button>
            ) : null}
          </span>
        ),
    },
  ];

  return (
    <div className="stack">
      {isTeam ? (
        <div className="u-row">
          <Button onClick={() => setAsking(true)}>Ask the client to approve</Button>
        </div>
      ) : null}
      <ErrorAlert error={list.error} title="We couldn't load approvals" />
      <ErrorAlert error={m.withdraw.error} title="We couldn't withdraw this request" />
      {list.isPending ? (
        <SkeletonRows label="Loading approvals…" />
      ) : data.length === 0 ? (
        <EmptyState
          icon={OwnerPortalIcon}
          title="Nothing to approve"
          description="Decisions the builder needs from the client will appear here."
        />
      ) : (
        <DataTable caption="Approvals" columns={columns} rows={data} getRowId={(a) => a.id} />
      )}
      {asking ? <RequestDialog onClose={() => setAsking(false)} /> : null}
      {deciding ? <DecideDialog approval={deciding} onClose={() => setDeciding(null)} /> : null}
    </div>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const m = useOwnerPortalMutations();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const cents = parseDollars(amount);
  const amountBad = amount.trim() !== '' && cents === null;
  const valid = title.trim() !== '' && !amountBad;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    m.requestApproval.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        amountCents: cents,
        dueDate: due || null,
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Ask the client to approve"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="request-form"
            disabled={!valid || m.requestApproval.isPending}
          >
            {m.requestApproval.isPending ? 'Sending…' : 'Send request'}
          </Button>
        </>
      }
    >
      <form id="request-form" className="stack" onSubmit={submit}>
        <TextField
          label="What needs approving"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Details"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextField
          label="Amount (AUD, optional)"
          inputMode="decimal"
          value={amount}
          error={amountBad ? 'Enter a dollar amount, for example 4500.00' : undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          label="Needed by (optional)"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <ErrorAlert error={m.requestApproval.error} title="We couldn't send this request" />
      </form>
    </Dialog>
  );
}

function DecideDialog({ approval, onClose }: { approval: Approval; onClose: () => void }) {
  const m = useOwnerPortalMutations();
  const [note, setNote] = useState('');
  const decide = (decision: 'approved' | 'rejected') =>
    m.decide.mutate(
      { id: approval.id, decision, note: note.trim() || undefined },
      { onSuccess: onClose },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Decide: ${approval.title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={m.decide.isPending}
            onClick={() => decide('rejected')}
          >
            Reject
          </Button>
          <Button disabled={m.decide.isPending} onClick={() => decide('approved')}>
            Approve
          </Button>
        </>
      }
    >
      <div className="stack">
        {approval.description ? <p>{approval.description}</p> : null}
        {approval.amountCents !== null ? <p>Amount: {money(approval.amountCents)}</p> : null}
        <p className="u-caption">A decision is final and is recorded under your name.</p>
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorAlert error={m.decide.error} title="We couldn't record your decision" />
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------ capital plan

type PlanItem = CapitalPlan['items'][number];

function CapitalTab({ isTeam }: { isTeam: boolean }) {
  const plan = useCapitalPlan();
  const [adding, setAdding] = useState(false);
  const items = plan.data?.items ?? [];
  const totals = plan.data?.totals ?? [];
  const label = (y: number | null) => (y === null ? 'All years' : `FY${y}`);

  const columns: DataTableColumn<PlanItem>[] = [
    {
      id: 'year',
      header: 'Year',
      rowHeader: true,
      sortValue: (i) => i.fiscalYear,
      cell: (i) => `FY${i.fiscalYear}`,
    },
    {
      id: 'category',
      header: 'Category',
      cell: (i) => (
        <>
          {i.category}
          {i.description ? <span className="u-caption"> · {i.description}</span> : null}
        </>
      ),
    },
    { id: 'budget', header: 'Budget', align: 'end', cell: (i) => money(i.budgetCents) },
    { id: 'forecast', header: 'Forecast', align: 'end', cell: (i) => money(i.forecastCents) },
    { id: 'spent', header: 'Spent', align: 'end', cell: (i) => money(i.spentCents) },
  ];
  const totalColumns: DataTableColumn<(typeof totals)[number]>[] = [
    { id: 'year', header: 'Year', rowHeader: true, cell: (t) => label(t.fiscalYear) },
    { id: 'budget', header: 'Budget', align: 'end', cell: (t) => money(t.budgetCents) },
    { id: 'forecast', header: 'Forecast', align: 'end', cell: (t) => money(t.forecastCents) },
    { id: 'spent', header: 'Spent', align: 'end', cell: (t) => money(t.spentCents) },
  ];

  return (
    <div className="stack">
      {isTeam ? (
        <div className="u-row">
          <Button onClick={() => setAdding(true)}>Add a line</Button>
        </div>
      ) : null}
      <ErrorAlert error={plan.error} title="We couldn't load the capital plan" />
      {plan.isPending ? (
        <SkeletonRows label="Loading the capital plan…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={OwnerPortalIcon}
          title="No capital plan yet"
          description="Budget, forecast and spend by year will appear here."
        />
      ) : (
        <>
          <DataTable caption="Capital plan" columns={columns} rows={items} getRowId={(i) => i.id} />
          <DataTable
            caption="Capital plan totals"
            columns={totalColumns}
            rows={totals}
            getRowId={(t) => label(t.fiscalYear)}
          />
        </>
      )}
      {adding ? <ItemDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function ItemDialog({ onClose }: { onClose: () => void }) {
  const m = useOwnerPortalMutations();
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [forecast, setForecast] = useState('');
  const [spent, setSpent] = useState('');
  const b = parseDollars(budget);
  const f = parseDollars(forecast);
  const s = spent.trim() === '' ? 0 : parseDollars(spent);
  const y = Number(year);
  const valid =
    category.trim() !== '' &&
    Number.isInteger(y) &&
    y >= 2000 &&
    y <= 2100 &&
    b !== null &&
    f !== null &&
    s !== null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    m.addItem.mutate(
      {
        fiscalYear: y,
        category: category.trim(),
        description: description.trim(),
        budgetCents: b,
        forecastCents: f,
        spentCents: s,
      },
      { onSuccess: onClose },
    );
  };
  const money_error = (text: string, v: number | null) =>
    text.trim() !== '' && v === null ? 'Enter a dollar amount, for example 250000' : undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a capital plan line"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" disabled={!valid || m.addItem.isPending}>
            {m.addItem.isPending ? 'Saving…' : 'Add line'}
          </Button>
        </>
      }
    >
      <form id="item-form" className="stack" onSubmit={submit}>
        <TextField
          label="Financial year (ending)"
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <TextField
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <TextField
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextField
          label="Budget (AUD)"
          inputMode="decimal"
          value={budget}
          error={money_error(budget, b)}
          onChange={(e) => setBudget(e.target.value)}
        />
        <TextField
          label="Forecast (AUD)"
          inputMode="decimal"
          value={forecast}
          error={money_error(forecast, f)}
          onChange={(e) => setForecast(e.target.value)}
        />
        <TextField
          label="Spent to date (AUD, optional)"
          inputMode="decimal"
          value={spent}
          error={money_error(spent, s)}
          onChange={(e) => setSpent(e.target.value)}
        />
        <ErrorAlert error={m.addItem.error} title="We couldn't add this line" />
      </form>
    </Dialog>
  );
}
