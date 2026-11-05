'use client';

import { InductionsIcon as ShieldCheck } from '@archova/ui/icons';
import { useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useFeatureFlag } from '@/shared/hooks/useFeatureFlag';
import { isApiError } from '@/shared/lib/errors';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCompanies, useForms, useRegister } from '../hooks/usePrequal';
import {
  QUALIFICATION_LABELS,
  scoreText,
  STATUS_LABELS,
  type PrequalSummary,
  type Qualification,
} from '../lib/types';
import { FormDialog } from './FormDialog';
import { StartFormDialog } from './StartFormDialog';
import { TemplatesPanel } from './TemplatesPanel';
import { QUALIFICATION_TONE } from './tones';

const STATES = Object.keys(QUALIFICATION_LABELS) as Qualification[];

function useCompanyNames() {
  const companies = useCompanies();
  const names = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  return (id: string) => names.get(id) ?? 'A company';
}

function Row({
  p,
  name,
  onOpen,
  showStatus,
}: {
  p: PrequalSummary;
  name: string;
  onOpen: (p: PrequalSummary) => void;
  showStatus: boolean;
}) {
  const score = scoreText(p);
  const label = showStatus ? STATUS_LABELS[p.status] : QUALIFICATION_LABELS[p.qualification];
  return (
    <li className="prequal__row">
      <div className="prequal__head">
        <strong>{name}</strong>
        <StatusPill tone={QUALIFICATION_TONE[p.qualification]}>{label}</StatusPill>
      </div>
      <span className="u-caption">
        {p.templateName}, version {p.templateVersion}
        {p.trades.length ? ` · ${p.trades.join(', ')}` : ''}
        {score ? ` · ${score}` : ''}
      </span>
      <span className="u-caption">
        {p.expiresOn ? `Approved until ${formatLocalDate(p.expiresOn)}` : 'No approval on record'}
        {p.concerns.length ? ` · ${p.concerns.length} to look at` : ''}
      </span>
      <div className="prequal__actions">
        <Button variant="secondary" onClick={() => onOpen(p)}>
          Open<span className="u-visually-hidden"> {name}’s form</span>
        </Button>
      </div>
    </li>
  );
}

function RegisterPanel({ onOpen }: { onOpen: (p: PrequalSummary) => void }) {
  const [state, setState] = useState<Qualification | ''>('');
  const [trade, setTrade] = useState('');
  const register = useRegister({ ...(state ? { state } : {}), ...(trade.trim() ? { trade } : {}) });
  const name = useCompanyNames();
  return (
    <div className="stack">
      <div className="prequal__filters">
        <Select
          label="Standing"
          value={state}
          onChange={(e) => setState(e.target.value as Qualification | '')}
          placeholder="All companies"
          options={STATES.map((s) => ({ value: s, label: QUALIFICATION_LABELS[s] }))}
        />
        <TextField
          label="Trade"
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
          maxLength={100}
        />
      </div>
      {register.isPending ? <SkeletonRows rows={3} label="Loading the register…" /> : null}
      {register.isError ? (
        isApiError(register.error, 403) ? (
          <p className="u-muted">You don’t have access to prequalification.</p>
        ) : (
          <ErrorAlert error={register.error} title="We couldn’t load the register" />
        )
      ) : null}
      {register.data && register.data.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={state || trade ? 'No companies match' : 'No companies prequalified yet'}
          description={
            state || trade
              ? 'Try a different standing or trade.'
              : 'Start a form for a subcontractor. Once a person approves it, they show here as qualified until it expires.'
          }
        />
      ) : null}
      {register.data?.length ? (
        <ul className="prequal__list">
          {register.data.map((p) => (
            <Row key={p.id} p={p} name={name(p.companyId)} onOpen={onOpen} showStatus={false} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FormsPanel({ onOpen }: { onOpen: (p: PrequalSummary) => void }) {
  const forms = useForms();
  const name = useCompanyNames();
  return (
    <div className="stack">
      {forms.isPending ? <SkeletonRows rows={3} label="Loading forms…" /> : null}
      {forms.isError ? <ErrorAlert error={forms.error} title="We couldn’t load the forms" /> : null}
      {forms.data && forms.data.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No forms yet"
          description="Forms you start for subcontractors show here, newest first."
        />
      ) : null}
      {forms.data?.length ? (
        <ul className="prequal__list">
          {forms.data.map((p) => (
            <Row key={p.id} p={p} name={name(p.companyId)} onOpen={onOpen} showStatus />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PrequalScreen() {
  const enabled = useFeatureFlag('subcontractor_prequalification');
  const { role } = useCurrentOrg();
  const isAdmin = role === 'owner' || role === 'admin';
  const [tab, setTab] = useState('register');
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<PrequalSummary | string | null>(null);
  const name = useCompanyNames();

  if (!enabled) {
    return (
      <>
        <PageHeader title="Prequalification" />
        <EmptyState
          icon={ShieldCheck}
          title="Prequalification isn’t switched on for this company"
          description="Ask Archova support to turn it on."
        />
      </>
    );
  }

  const tabs = [
    { id: 'register', label: 'Register' },
    { id: 'forms', label: 'Forms' },
    ...(isAdmin ? [{ id: 'templates', label: 'Question sets' }] : []),
  ];
  const openId = typeof open === 'string' ? open : (open?.id ?? null);
  const openName = typeof open === 'string' || !open ? 'Company' : name(open.companyId);

  return (
    <>
      <PageHeader
        title="Prequalification"
        description="Which subcontractors are qualified today. A person approves each form, and an approval runs out on its date. Archova doesn’t decide for you."
        actions={<Button onClick={() => setStarting(true)}>Start a form</Button>}
      />
      <Card>
        <Tabs label="Prequalification" tabs={tabs} value={tab} onValueChange={setTab}>
          {tab === 'register' ? <RegisterPanel onOpen={setOpen} /> : null}
          {tab === 'forms' ? <FormsPanel onOpen={setOpen} /> : null}
          {tab === 'templates' && isAdmin ? <TemplatesPanel /> : null}
        </Tabs>
      </Card>
      {starting ? (
        <StartFormDialog
          onClose={() => setStarting(false)}
          onCreated={(id) => {
            setStarting(false);
            setOpen(id);
          }}
        />
      ) : null}
      {openId ? (
        <FormDialog
          formId={openId}
          companyName={openName}
          canDecide={isAdmin}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
