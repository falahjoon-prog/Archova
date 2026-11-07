'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import type { CohortDto, FlagChangeInput, FlagDto } from '@archova/contracts';
import { api } from '@/shared/api';
import { ReasonDialog } from '@/shared/ReasonDialog';
import { useStepUp } from '@/shared/StepUp';
import { can, useStaff } from '@/shared/staff';
import { formatDateTime } from '@/shared/format';

type Pending = {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  run: (reason: string) => Promise<unknown>;
};

function flagState(f: FlagDto): { tone: 'success' | 'neutral' | 'warning'; label: string } {
  if (f.enabledForAll) return { tone: 'success', label: 'On for all orgs' };
  if (f.percent > 0) return { tone: 'warning', label: `${f.percent}% of orgs` };
  if (f.orgs.length || f.cohorts.length) return { tone: 'warning', label: 'Pilot only' };
  return { tone: 'neutral', label: 'Off' };
}

function FlagCard({
  flag,
  cohorts,
  orgs,
  onChange,
  onKill,
}: {
  flag: FlagDto;
  cohorts: CohortDto[];
  orgs: Array<{ orgId: string; name: string }>;
  onChange: (title: string, body: (reason: string) => FlagChangeInput) => void;
  onKill: () => void;
}) {
  const staff = useStaff();
  const canEdit = can(staff, 'backoffice.flags.edit');
  const isOwner = staff.roles.includes('owner');
  const [orgId, setOrgId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [percent, setPercent] = useState(String(flag.percent));
  const state = flagState(flag);
  const pct = Number(percent);
  const pctValid = Number.isInteger(pct) && pct >= 0 && pct <= 100;

  return (
    <Card>
      <div className="stack">
        <div className="row">
          <h2 className="flag__title">{flag.key}</h2>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </div>
        <p>{flag.description}</p>
        <p className="muted">
          Owner {flag.owner} · remove by {flag.removeBy}
          {flag.lastChange
            ? ` · last change: ${flag.lastChange.summary} by ${flag.lastChange.by}, ${formatDateTime(flag.lastChange.at)}`
            : ''}
        </p>
        <div className="flag__targets">
          {flag.orgs.map((o) => (
            <span key={o.orgId} className="flag__chip">
              {o.name}
              {canEdit ? (
                <button
                  type="button"
                  className="flag__chip-x"
                  aria-label={`Turn off for ${o.name}`}
                  onClick={() =>
                    onChange(`Turn off ${flag.key} for ${o.name}?`, (reason) => ({
                      scope: 'org',
                      orgId: o.orgId,
                      on: false,
                      reason,
                    }))
                  }
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {flag.cohorts.map((c) => (
            <span key={c.id} className="flag__chip">
              Cohort: {c.name}
              {canEdit ? (
                <button
                  type="button"
                  className="flag__chip-x"
                  aria-label={`Turn off for cohort ${c.name}`}
                  onClick={() =>
                    onChange(`Turn off ${flag.key} for cohort ${c.name}?`, (reason) => ({
                      scope: 'cohort',
                      cohortId: c.id,
                      on: false,
                      reason,
                    }))
                  }
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {canEdit ? (
          <div className="flag__forms">
            <div className="flag__form">
              <Select
                label="Company"
                placeholder="Choose a company"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                options={orgs
                  .filter((o) => !flag.orgs.some((x) => x.orgId === o.orgId))
                  .map((o) => ({ value: o.orgId, label: o.name }))}
              />
              <Button
                variant="secondary"
                disabled={!orgId}
                onClick={() =>
                  onChange(`Turn on ${flag.key} for this company?`, (reason) => ({
                    scope: 'org',
                    orgId,
                    on: true,
                    reason,
                  }))
                }
              >
                Turn on for company
              </Button>
            </div>
            <div className="flag__form">
              <Select
                label="Pilot cohort"
                placeholder="Choose a cohort"
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
                options={cohorts
                  .filter((c) => !flag.cohorts.some((x) => x.id === c.id))
                  .map((c) => ({ value: c.id, label: c.name }))}
              />
              <Button
                variant="secondary"
                disabled={!cohortId}
                onClick={() =>
                  onChange(`Turn on ${flag.key} for this cohort?`, (reason) => ({
                    scope: 'cohort',
                    cohortId,
                    on: true,
                    reason,
                  }))
                }
              >
                Turn on for cohort
              </Button>
            </div>
            {isOwner ? (
              <div className="flag__form">
                <TextField
                  label="Share of orgs (%)"
                  inputMode="numeric"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  error={pctValid ? undefined : 'A whole number from 0 to 100'}
                />
                <Button
                  variant="secondary"
                  disabled={!pctValid || pct === flag.percent}
                  onClick={() =>
                    onChange(`Set ${flag.key} to ${pct}% of orgs?`, (reason) => ({
                      scope: 'percent',
                      percent: pct,
                      reason,
                    }))
                  }
                >
                  Set rollout
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {canEdit ? (
          <div className="row row--end">
            {isOwner ? (
              <Button
                variant="secondary"
                onClick={() =>
                  onChange(
                    flag.enabledForAll
                      ? `Turn off ${flag.key} for all orgs?`
                      : `Turn on ${flag.key} for all orgs?`,
                    (reason) => ({ scope: 'all', on: !flag.enabledForAll, reason }),
                  )
                }
              >
                {flag.enabledForAll ? 'Turn off for all' : 'Turn on for all'}
              </Button>
            ) : null}
            <Button variant="danger" onClick={onKill}>
              Kill switch
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Cohorts({ cohorts }: { cohorts: CohortDto[] }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const canEdit = can(staff, 'backoffice.flags.edit');
  const orgs = useQuery({
    queryKey: ['orgs', 'all'],
    queryFn: () => api.orgs({ limit: 100 }),
    enabled: can(staff, 'backoffice.customers.read'),
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cohorts'] });
  const create = useMutation({
    mutationFn: () => api.createCohort({ name, description }),
    onSuccess: () => {
      setName('');
      setDescription('');
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const add = useMutation({
    mutationFn: (v: { id: string; orgId: string }) => api.addCohortMember(v.id, v.orgId),
    onSuccess: (_d, v) => {
      setPick((p) => ({ ...p, [v.id]: '' }));
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (v: { id: string; orgId: string }) => api.removeCohortMember(v.id, v.orgId),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <section className="stack" aria-labelledby="cohorts-title">
      <h2 id="cohorts-title" className="flag__section">
        Pilot cohorts
      </h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {canEdit ? (
        <Card>
          <div className="flag__form flag__form--wide">
            <TextField label="New cohort" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={name.trim().length < 2}
            >
              Create cohort
            </Button>
          </div>
        </Card>
      ) : null}
      {cohorts.length === 0 ? (
        <EmptyState
          title="No cohorts yet"
          description="A cohort groups pilot customers so a flag can be turned on for all of them at once."
        />
      ) : (
        cohorts.map((c) => (
          <Card key={c.id}>
            <div className="stack">
              <div>
                <h3 className="flag__title">{c.name}</h3>
                {c.description ? <p className="muted">{c.description}</p> : null}
              </div>
              <div className="flag__targets">
                {c.members.length === 0 ? <span className="muted">No companies yet.</span> : null}
                {c.members.map((m) => (
                  <span key={m.orgId} className="flag__chip">
                    {m.name}
                    {canEdit ? (
                      <button
                        type="button"
                        className="flag__chip-x"
                        aria-label={`Remove ${m.name} from ${c.name}`}
                        onClick={() => remove.mutate({ id: c.id, orgId: m.orgId })}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
              {canEdit && orgs.data ? (
                <div className="flag__form">
                  <Select
                    label="Add a company"
                    placeholder="Choose a company"
                    value={pick[c.id] ?? ''}
                    onChange={(e) => setPick((p) => ({ ...p, [c.id]: e.target.value }))}
                    options={orgs.data.items
                      .filter((o) => !c.members.some((m) => m.orgId === o.orgId))
                      .map((o) => ({ value: o.orgId, label: o.name }))}
                  />
                  <Button
                    variant="secondary"
                    disabled={!pick[c.id]}
                    onClick={() => add.mutate({ id: c.id, orgId: pick[c.id]! })}
                  >
                    Add to cohort
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        ))
      )}
    </section>
  );
}

export default function FlagsPage() {
  const qc = useQueryClient();
  const staff = useStaff();
  const withStepUp = useStepUp();
  const flags = useQuery({ queryKey: ['flags'], queryFn: api.flags });
  const cohorts = useQuery({ queryKey: ['cohorts'], queryFn: api.cohorts });
  const orgs = useQuery({
    queryKey: ['orgs', 'all'],
    queryFn: () => api.orgs({ limit: 100 }),
    enabled: can(staff, 'backoffice.customers.read'),
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['flags'] });
    void qc.invalidateQueries({ queryKey: ['cohorts'] });
  };

  return (
    <>
      <PageHeader
        title="Flags and pilots"
        description="Launch a feature to one company, a pilot cohort, a share of orgs or everyone. A flag never makes a module reachable that a plan does not include."
      />
      {done ? <Alert tone="success">{done}</Alert> : null}
      {flags.isError ? (
        <Alert tone="danger" title="Could not load flags">
          {flags.error.message}
        </Alert>
      ) : flags.isPending || cohorts.isPending ? (
        <SkeletonRows />
      ) : (
        <div className="stack">
          {flags.data.items.map((f) => (
            <FlagCard
              key={f.key}
              flag={f}
              cohorts={cohorts.data?.items ?? []}
              orgs={orgs.data?.items ?? []}
              onChange={(title, body) =>
                setPending({
                  title,
                  confirmLabel: 'Apply',
                  run: (reason) =>
                    withStepUp(() => api.updateFlag(f.key, body(reason))).then(() =>
                      setDone(`${f.key} updated.`),
                    ),
                })
              }
              onKill={() =>
                setPending({
                  title: `Kill ${f.key}?`,
                  confirmLabel: 'Kill switch',
                  danger: true,
                  run: (reason) =>
                    api
                      .killFlag(f.key, reason)
                      .then(() => setDone(`${f.key} is off for every org.`)),
                })
              }
            />
          ))}
          <Cohorts cohorts={cohorts.data?.items ?? []} />
        </div>
      )}
      <ReasonDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        description="This takes effect straight away and is recorded with your name."
        confirmLabel={pending?.confirmLabel ?? 'Apply'}
        {...(pending?.danger ? { danger: true } : {})}
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          await pending?.run(reason);
          refresh();
        }}
      />
    </>
  );
}
