'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
} from '@archova/ui';
import {
  PLAN_MODULE_KEYS,
  type PlanDraftInput,
  type PlanDto,
  type PlanVersionDto,
} from '@archova/contracts';
import { api } from '@/shared/api';
import { ReasonDialog } from '@/shared/ReasonDialog';
import { can, useStaff } from '@/shared/staff';

const MODULE_LABEL: Record<string, string> = {
  documents: 'Documents and drawings',
  rfis: 'RFIs',
  submittals: 'Submittals',
  diary: 'Site diary',
  defects: 'Defects',
  quality: 'Inspections and observations',
  safety: 'SWMS register',
  photos: 'Photos',
  meetings: 'Meetings',
  correspondence: 'Correspondence',
  workforce: 'Workforce sign-in',
  inductions: 'Online inductions',
  variations: 'Variations',
  claims: 'Claims',
  estimating: 'Estimating',
  ai: 'Ask Nova',
};

interface FormState {
  name: string;
  blurb: string;
  features: string;
  modules: string[];
  credits: string;
  ctaLabel: string;
  ctaHref: string;
}

const EMPTY: FormState = {
  name: '',
  blurb: '',
  features: '',
  modules: [],
  credits: '',
  ctaLabel: 'Request a demo',
  ctaHref: '/demo',
};

const fromVersion = (v: PlanVersionDto): FormState => ({
  name: v.name,
  blurb: v.blurb,
  features: v.features.join('\n'),
  modules: v.modules,
  credits: v.aiCreditsMonthly === null ? '' : String(v.aiCreditsMonthly),
  ctaLabel: v.ctaLabel,
  ctaHref: v.ctaHref,
});

function toDraft(f: FormState): PlanDraftInput {
  return {
    name: f.name,
    blurb: f.blurb,
    features: f.features
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
    modules: f.modules as PlanDraftInput['modules'],
    aiCreditsMonthly: f.credits.trim() === '' ? null : Math.round(Number(f.credits)),
    ctaLabel: f.ctaLabel,
    ctaHref: f.ctaHref,
  };
}

function PlanForm({
  value,
  onChange,
  disabled,
}: {
  value: FormState;
  onChange: (v: FormState) => void;
  disabled?: boolean;
}) {
  const set = (p: Partial<FormState>) => onChange({ ...value, ...p });
  return (
    <div className="stack">
      <div className="form-grid form-grid--2">
        <TextField
          label="Name"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          disabled={disabled}
          maxLength={60}
        />
        <TextField
          label="Nova credits a month"
          inputMode="numeric"
          value={value.credits}
          onChange={(e) => set({ credits: e.target.value.replace(/[^\d]/g, '') })}
          disabled={disabled}
          hint="Included in the plan each month."
        />
      </div>
      <TextField
        label="Summary"
        value={value.blurb}
        onChange={(e) => set({ blurb: e.target.value })}
        disabled={disabled}
        maxLength={200}
      />
      <Textarea
        label="Features shown on the pricing page"
        rows={5}
        value={value.features}
        onChange={(e) => set({ features: e.target.value })}
        disabled={disabled}
        hint="One per line, up to 12."
      />
      <fieldset
        className="stack"
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        disabled={disabled}
      >
        <legend style={{ padding: 0, fontWeight: 600 }}>Included modules</legend>
        <div className="checks">
          {PLAN_MODULE_KEYS.map((m) => (
            <Checkbox
              key={m}
              label={MODULE_LABEL[m] ?? m}
              checked={value.modules.includes(m)}
              onChange={(e) =>
                set({
                  modules: e.target.checked
                    ? [...value.modules, m]
                    : value.modules.filter((x) => x !== m),
                })
              }
            />
          ))}
        </div>
      </fieldset>
      <div className="form-grid form-grid--2">
        <TextField
          label="Button label"
          value={value.ctaLabel}
          onChange={(e) => set({ ctaLabel: e.target.value })}
          disabled={disabled}
          maxLength={40}
        />
        <TextField
          label="Button link"
          value={value.ctaHref}
          onChange={(e) => set({ ctaHref: e.target.value })}
          disabled={disabled}
          hint="A page on the website, such as /demo."
        />
      </div>
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanDto }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const edit = can(staff, 'backoffice.pricing.edit');
  const shown = plan.draft ?? plan.published;
  const locked = plan.draft?.status === 'pending_approval';
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => (shown ? fromVersion(shown) : EMPTY));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['plans'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
  };
  const save = useMutation({
    mutationFn: () => api.savePlanDraft(plan.code, toDraft(form)),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const discard = useMutation({
    mutationFn: () => api.discardPlanDraft(plan.code),
    onSuccess: () => {
      setOpen(false);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const v = plan.published ?? plan.draft;
  return (
    <Card
      title={shown?.name ?? plan.code}
      headingLevel={3}
      actions={
        plan.draft ? (
          <StatusPill tone={locked ? 'warning' : 'neutral'}>
            {locked ? 'Waiting for approval' : 'Draft'}
          </StatusPill>
        ) : (
          <StatusPill tone="success">Live</StatusPill>
        )
      }
    >
      <div className="stack">
        <p className="muted">{v?.blurb}</p>
        <ul className="plan-card__features">
          {(v?.features ?? []).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="muted">
          {v?.modules.length ?? 0} modules · {v?.aiCreditsMonthly?.toLocaleString('en-AU') ?? 'No'}{' '}
          Nova credits a month
        </p>
        {locked ? (
          <Alert
            tone="info"
            action={
              <Link className="link" href="/approvals">
                Open approvals
              </Link>
            }
          >
            This draft is waiting for a decision.
          </Alert>
        ) : null}
        {open && edit && !locked ? (
          <>
            <PlanForm value={form} onChange={setForm} />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="row row--end">
              {plan.draft ? (
                <Button
                  variant="tertiary"
                  onClick={() => discard.mutate()}
                  loading={discard.isPending}
                >
                  Discard draft
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending}>
                Save draft
              </Button>
              <Button onClick={() => setSubmitting(true)} disabled={!plan.draft || save.isPending}>
                Submit for approval
              </Button>
            </div>
          </>
        ) : edit && !locked ? (
          <div className="row">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setForm(shown ? fromVersion(shown) : EMPTY);
                setOpen(true);
              }}
            >
              {plan.draft ? 'Edit draft' : 'Change this plan'}
            </Button>
          </div>
        ) : null}
      </div>
      <ReasonDialog
        open={submitting}
        title="Submit this plan change for approval?"
        description="A second person has to approve it before it reaches the pricing page."
        confirmLabel="Submit"
        onClose={() => setSubmitting(false)}
        onConfirm={async (reason) => {
          await api.submitPlanDraft(plan.code, reason);
          setOpen(false);
          refresh();
        }}
      />
    </Card>
  );
}

function NewPlan({ onClose, open }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createPlan(code, toDraft(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plans'] });
      setCode('');
      setForm(EMPTY);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New plan"
      description="It stays hidden from the pricing page until a price book prices it."
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!code || !form.name}
          >
            Create draft
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toLowerCase())}
          hint="Lower-case letters, digits and underscores. It cannot change later."
          maxLength={30}
        />
        <PlanForm value={form} onChange={setForm} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}

export default function PlansPage() {
  const staff = useStaff();
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Plans"
        description="What each plan includes. Changes are drafted here and go live after a second person approves them."
        actions={
          can(staff, 'backoffice.pricing.edit') ? (
            <Button onClick={() => setCreating(true)}>New plan</Button>
          ) : undefined
        }
      />
      {plans.isError ? (
        <Alert tone="danger" title="Could not load plans">
          {plans.error.message}
        </Alert>
      ) : plans.isPending ? (
        <SkeletonRows rows={5} />
      ) : (
        <div className="plan-grid">
          {plans.data.items.map((p) => (
            <PlanCard
              key={`${p.code}:${p.draft?.id ?? ''}:${p.published?.id ?? ''}:${p.draft?.status ?? ''}`}
              plan={p}
            />
          ))}
        </div>
      )}
      <NewPlan open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
