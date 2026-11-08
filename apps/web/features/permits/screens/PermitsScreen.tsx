'use client';

import { useState } from 'react';
import { atLeast } from '@archova/domain/permissions';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { PermitsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { LocalDate } from '@archova/time';
import {
  usePermitFlags,
  usePermitList,
  usePermitMutations,
  usePermitRequirements,
} from '../hooks/usePermits';
import {
  ACTION_LABELS,
  KINDS,
  KIND_LABELS,
  STATUSES,
  STATUS_LABELS,
  SUGGESTED_REQUIREMENTS,
  availableActions,
  type Permit,
  type PermitAction,
  type PermitInput,
  type PermitKind,
  type PermitStatus,
  type Requirement,
} from '../lib/types';

const STATUS_TONE: Record<PermitStatus, StatusTone> = {
  active: 'success',
  expiring_soon: 'warning',
  expired: 'danger',
  renewal_in_progress: 'info',
  closed: 'neutral',
};

const day = (d: string | null) => (d ? formatLocalDate(d as LocalDate) : '—');

/** The project's permits and approvals register, with Nova's rule-based flags for what needs attention. */
export function PermitsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const canManage =
    org.role === 'owner' ||
    org.role === 'admin' ||
    atLeast(perms.data?.toolLevels.inspections, 'admin');
  const [params, setParams] = useUrlState(['status', 'kind'] as const);
  const status = STATUSES.includes(params.status as PermitStatus)
    ? (params.status as PermitStatus)
    : undefined;
  const kind = KINDS.includes(params.kind as PermitKind) ? (params.kind as PermitKind) : undefined;
  const list = usePermitList({ status, kind });
  const flags = usePermitFlags();
  const reqs = usePermitRequirements();
  const m = usePermitMutations();
  const [editing, setEditing] = useState<Permit | 'new' | null>(null);
  const [renewing, setRenewing] = useState<Permit | null>(null);
  const [expecting, setExpecting] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'permit', id: 'register' },
  });

  const act = (p: Permit, action: PermitAction) =>
    action === 'markRenewed'
      ? setRenewing(p)
      : m.transition.mutate({ permit: p, input: { action } });

  const columns: DataTableColumn<Permit>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (p) => p.numberLabel,
      cell: (p) => p.numberLabel,
    },
    {
      id: 'title',
      header: 'Permit',
      sortValue: (p) => p.title,
      cell: (p) => (
        <>
          {p.title}
          {p.referenceNumber ? <div className="u-muted">Ref {p.referenceNumber}</div> : null}
        </>
      ),
    },
    { id: 'kind', header: 'Type', sortValue: (p) => p.kind, cell: (p) => KIND_LABELS[p.kind] },
    {
      id: 'authority',
      header: 'Issued by',
      sortValue: (p) => p.issuingAuthority,
      cell: (p) => p.issuingAuthority ?? '—',
    },
    {
      id: 'holder',
      header: 'Holder',
      cell: (p) => (p.holderCompanyId ? dir.companyName(p.holderCompanyId) : '—'),
    },
    { id: 'issued', header: 'Issued', sortValue: (p) => p.issuedOn, cell: (p) => day(p.issuedOn) },
    {
      id: 'expires',
      header: 'Expires',
      sortValue: (p) => p.expiresOn,
      cell: (p) => (
        <>
          {day(p.expiresOn)}
          {p.daysToExpiry !== null && p.status !== 'closed' ? (
            <div className="u-muted">
              {p.daysToExpiry < 0
                ? `${-p.daysToExpiry} day${p.daysToExpiry === -1 ? '' : 's'} ago`
                : p.daysToExpiry === 0
                  ? 'today'
                  : `in ${p.daysToExpiry} day${p.daysToExpiry === 1 ? '' : 's'}`}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (p) => p.status,
      cell: (p) => <StatusPill tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status]}</StatusPill>,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (p: Permit) => (
              <span className="row-actions">
                {availableActions(p.status).map((a) => (
                  <Button
                    key={a}
                    variant="tertiary"
                    disabled={m.transition.isPending}
                    aria-label={`${ACTION_LABELS[a]} ${p.numberLabel}`}
                    onClick={() => act(p, a)}
                  >
                    {ACTION_LABELS[a]}
                  </Button>
                ))}
                <Button
                  variant="tertiary"
                  aria-label={`Edit ${p.numberLabel}`}
                  onClick={() => setEditing(p)}
                >
                  Edit
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<Permit>,
        ]
      : []),
  ];

  const filtered = Boolean(status || kind);
  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Permits and approvals"
        description="Building permits, council approvals, environmental and road permits for this project. Nova flags what is expiring, expired or missing. Licences held by companies and workers live in the compliance wallet."
        actions={
          canManage ? (
            <>
              <Button variant="secondary" onClick={() => setExpecting(true)}>
                Expected permits
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus size={16} aria-hidden="true" /> Add permit
              </Button>
            </>
          ) : null
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Permits" /> : null}
      <ErrorAlert error={m.transition.error} title="We couldn't update that permit" />
      {(flags.data ?? []).length > 0 ? (
        <Card title="Needs attention" actions={<StatusPill tone="ai">Nova flags</StatusPill>}>
          <ul className="plain-list">
            {(flags.data ?? []).map((f, i) => {
              const target = f.permitId ? list.data?.find((p) => p.id === f.permitId) : undefined;
              return (
                <li key={`${f.kind}-${f.permitId ?? f.permitKind ?? i}`}>
                  <Alert
                    tone={f.severity === 'high' ? 'danger' : 'warning'}
                    title={f.title}
                    action={
                      canManage && target && f.kind === 'expiring' ? (
                        <Button variant="secondary" onClick={() => act(target, 'startRenewal')}>
                          Start renewal
                        </Button>
                      ) : canManage && f.kind === 'missing_required' ? (
                        <Button variant="secondary" onClick={() => setEditing('new')}>
                          Add permit
                        </Button>
                      ) : undefined
                    }
                  >
                    {f.detail}
                  </Alert>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <FilterBar label="Filter permits">
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Type"
          value={params.kind}
          placeholder="Any type"
          options={KINDS.map((v) => ({ value: v, label: KIND_LABELS[v] }))}
          onChange={(e) => setParams({ kind: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load permits" />
      {list.isPending ? (
        <SkeletonRows label="Loading permits…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={PermitsIcon}
          title={filtered ? 'No permits match' : 'No permits on the register'}
          description={
            filtered
              ? 'Try different filters.'
              : 'Add the building permit, council approvals and any road or environmental permits this project needs.'
          }
        />
      ) : (
        <DataTable
          caption="Permits and approvals"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(p) => p.id}
        />
      )}
      {editing ? (
        <PermitDialog
          permit={editing === 'new' ? null : editing}
          dir={dir}
          pending={m.create.isPending || m.update.isPending}
          error={m.create.error ?? m.update.error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === 'new'
              ? m.create.mutate(input, { onSuccess: () => setEditing(null) })
              : m.update.mutate({ permit: editing, input }, { onSuccess: () => setEditing(null) })
          }
        />
      ) : null}
      {renewing ? (
        <RenewedDialog
          permit={renewing}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setRenewing(null)}
          onSave={(newExpiresOn) =>
            m.transition.mutate(
              { permit: renewing, input: { action: 'markRenewed', newExpiresOn } },
              { onSuccess: () => setRenewing(null) },
            )
          }
        />
      ) : null}
      {expecting ? (
        <ExpectedDialog
          current={reqs.data ?? []}
          pending={m.setRequirements.isPending}
          error={m.setRequirements.error}
          onClose={() => setExpecting(false)}
          onSave={(items) =>
            m.setRequirements.mutate(items, { onSuccess: () => setExpecting(false) })
          }
        />
      ) : null}
    </>
  );
}

function PermitDialog({
  permit,
  dir,
  pending,
  error,
  onClose,
  onSave,
}: {
  permit: Permit | null;
  dir: ReturnType<typeof useProjectDirectory>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: PermitInput) => void;
}) {
  const [kind, setKind] = useState<PermitKind>(permit?.kind ?? 'building_permit');
  const [title, setTitle] = useState(permit?.title ?? '');
  const [authority, setAuthority] = useState(permit?.issuingAuthority ?? '');
  const [reference, setReference] = useState(permit?.referenceNumber ?? '');
  const [holder, setHolder] = useState(permit?.holderCompanyId ?? '');
  const [issued, setIssued] = useState(permit?.issuedOn ?? '');
  const [expires, setExpires] = useState(permit?.expiresOn ?? '');
  const [notes, setNotes] = useState(permit?.notes ?? '');
  const backwards = Boolean(issued && expires && issued > expires);
  return (
    <Dialog
      open
      onClose={onClose}
      title={permit ? `Edit ${permit.numberLabel}` : 'Add permit'}
      description="Record what the issuing authority gave you. Archova keeps the dates and reminds you before it runs out; it doesn't check the permit with the authority."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || backwards || pending}
            onClick={() =>
              onSave({
                kind,
                title: title.trim(),
                issuingAuthority: authority.trim() || null,
                referenceNumber: reference.trim() || null,
                holderCompanyId: holder || null,
                issuedOn: issued || null,
                expiresOn: expires || null,
                notes: notes.trim() || null,
              })
            }
          >
            {pending ? 'Saving…' : permit ? 'Save changes' : 'Add permit'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Type"
          value={kind}
          options={KINDS.map((v) => ({ value: v, label: KIND_LABELS[v] }))}
          onChange={(e) => setKind(e.target.value as PermitKind)}
        />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Issuing authority"
          value={authority}
          onChange={(e) => setAuthority(e.target.value)}
        />
        <TextField
          label="Reference number"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Select
          label="Held by"
          value={holder}
          placeholder="The project"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setHolder(e.target.value)}
        />
        <TextField
          label="Issued"
          type="date"
          value={issued}
          onChange={(e) => setIssued(e.target.value)}
        />
        <TextField
          label="Expires"
          type="date"
          value={expires}
          error={backwards ? 'The expiry date is before the issue date.' : undefined}
          onChange={(e) => setExpires(e.target.value)}
        />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the permit" />
      </div>
    </Dialog>
  );
}

function RenewedDialog({
  permit,
  pending,
  error,
  onClose,
  onSave,
}: {
  permit: Permit;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (newExpiresOn: string) => void;
}) {
  const [date, setDate] = useState('');
  const tooEarly = Boolean(date && permit.expiresOn && date <= permit.expiresOn);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mark ${permit.numberLabel} renewed`}
      description={`Currently expires ${day(permit.expiresOn)}. Reminders start again from the new date.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!date || tooEarly || pending} onClick={() => onSave(date)}>
            {pending ? 'Saving…' : 'Mark renewed'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="New expiry date"
          type="date"
          value={date}
          error={tooEarly ? 'Must be after the current expiry date.' : undefined}
          onChange={(e) => setDate(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't renew the permit" />
      </div>
    </Dialog>
  );
}

function ExpectedDialog({
  current,
  pending,
  error,
  onClose,
  onSave,
}: {
  current: Requirement[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (items: Requirement[]) => void;
}) {
  const [picked, setPicked] = useState<Map<PermitKind, number>>(
    () => new Map(current.map((r) => [r.kind, r.leadDays])),
  );
  const toggle = (k: PermitKind) =>
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(k)) next.delete(k);
      else next.set(k, 30);
      return next;
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Expected permits"
      description="Nova flags a project that has none of a type you expect, and warns this many days before each one expires."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => onSave([...picked].map(([kind, leadDays]) => ({ kind, leadDays })))}
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Button
          variant="secondary"
          onClick={() => setPicked(new Map(SUGGESTED_REQUIREMENTS.map((k) => [k, 30])))}
        >
          Use the suggested set for a new build
        </Button>
        <fieldset className="stack">
          <legend>Expect on this project</legend>
          {KINDS.filter((k) => k !== 'other').map((k) => (
            <div key={k} className="row-end">
              <label>
                <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />{' '}
                {KIND_LABELS[k]}
              </label>
              {picked.has(k) ? (
                <TextField
                  label={`Warn days before expiry, ${KIND_LABELS[k]}`}
                  type="number"
                  min={1}
                  max={365}
                  value={String(picked.get(k))}
                  onChange={(e) =>
                    setPicked((cur) =>
                      new Map(cur).set(k, Math.min(365, Math.max(1, Number(e.target.value) || 1))),
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </fieldset>
        <ErrorAlert error={error} title="We couldn't save the expected permits" />
      </div>
    </Dialog>
  );
}
