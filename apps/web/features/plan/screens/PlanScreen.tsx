'use client';

import {
  Alert,
  Card,
  DataTable,
  DescriptionList,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { usePlan } from '../hooks/usePlan';

const STATE: Record<string, { label: string; tone: StatusTone; note: string | null }> = {
  trialing: { label: 'Free trial', tone: 'info', note: null },
  active: { label: 'Active', tone: 'success', note: null },
  past_due: {
    label: 'Payment overdue',
    tone: 'warning',
    note: 'A payment is overdue. Your company can still work as normal, but the account will become read only if it stays unpaid.',
  },
  read_only: {
    label: 'Read only',
    tone: 'danger',
    note: 'Everyone can still see their records, but nothing can be added or changed until the account is back in good standing.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    note: 'This subscription has ended.',
  },
};

const MODULE_LABEL: Record<string, string> = {
  documents: 'Documents and drawings',
  rfis: 'RFIs',
  submittals: 'Submittals',
  diary: 'Site diary',
  defects: 'Defects',
  quality: 'Inspections and quality',
  safety: 'Safety and SWMS',
  photos: 'Photos',
  meetings: 'Meetings',
  correspondence: 'Correspondence',
  workforce: 'Workforce and attendance',
  estimating: 'Estimating',
  financials: 'Contracts, claims and payment schedules',
  claims: 'Contracts, claims and payment schedules',
  api: 'API access',
  ai: 'Ask Nova',
};
// Parts of the platform every plan has; not listed as something you bought.
const CORE = new Set([
  'platform',
  'access',
  'files',
  'identity',
  'sync',
  'integrations',
  'billing',
]);

const LIMIT_LABEL: Record<string, string> = {
  'limit.active_projects': 'Active projects',
  'limit.seats': 'People',
  'limit.storage_gb': 'Storage (GB)',
  'limit.ai_credits': 'Nova credits each month',
};

const label = (key: string) =>
  MODULE_LABEL[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1).replace(/[_-]+/g, ' ')}`;
const planName = (plan: string) =>
  `${plan.charAt(0).toUpperCase()}${plan.slice(1).replace(/[_-]+/g, ' ')}`;
const limitLabel = (key: string) => LIMIT_LABEL[key] ?? label(key.replace(/^limit\./, ''));

interface LimitRow {
  key: string;
  value: number | null;
}

/** The plan the company is on, what it includes and its limits. Changes go through the account manager. */
export function PlanScreen() {
  const plan = usePlan();
  const e = plan.data;
  const state = e
    ? (STATE[e.state] ?? { label: e.state, tone: 'neutral' as StatusTone, note: null })
    : null;
  const modules = (e?.modules ?? []).filter((m) => !CORE.has(m));
  // The same module can be listed under two names; show it once.
  const shown = [...new Set(modules.map(label))].sort((a, b) => a.localeCompare(b));
  const limits: LimitRow[] = Object.entries(e?.limits ?? {}).map(([key, value]) => ({
    key,
    value,
  }));
  const columns: DataTableColumn<LimitRow>[] = [
    { id: 'what', header: 'Limit', rowHeader: true, cell: (r) => limitLabel(r.key) },
    {
      id: 'value',
      header: 'Your plan allows',
      cell: (r) => (r.value === null ? 'No limit' : new Intl.NumberFormat('en-AU').format(r.value)),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Plan and limits"
        description="The plan your company is on, what it includes, and its limits."
      />
      <ErrorAlert error={plan.error} title="We couldn't load your plan" />
      {plan.isPending ? (
        <SkeletonRows label="Loading your plan…" />
      ) : e && state ? (
        <div className="stack">
          {state.note ? (
            <Alert tone={state.tone === 'danger' ? 'danger' : 'warning'} title={state.label}>
              {state.note}
            </Alert>
          ) : null}
          <DescriptionList
            items={[
              { label: 'Plan', value: planName(e.plan) },
              { label: 'Status', value: <StatusPill tone={state.tone}>{state.label}</StatusPill> },
            ]}
          />
          <Card>
            <h2>Included</h2>
            {shown.length === 0 ? (
              <p>Only the core platform.</p>
            ) : (
              <ul>
                {shown.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </Card>
          {limits.length > 0 ? (
            <DataTable caption="Limits" columns={columns} rows={limits} getRowId={(r) => r.key} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
