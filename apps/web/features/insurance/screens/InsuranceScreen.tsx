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
import { InsuranceIcon, Plus } from '@archova/ui/icons';
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
  useCoverFlags,
  useCoverList,
  useCoverMutations,
  useCoverRequirements,
} from '../hooks/useInsurance';
import {
  ACTION_LABELS,
  KINDS,
  KIND_LABELS,
  STATUSES,
  STATUS_LABELS,
  SUGGESTED_REQUIREMENTS,
  availableActions,
  categoryOf,
  centsToDollars,
  dollarsToCents,
  formatMoney,
  type Cover,
  type CoverAction,
  type CoverInput,
  type CoverKind,
  type CoverStatus,
  type Requirement,
} from '../lib/types';

const STATUS_TONE: Record<CoverStatus, StatusTone> = {
  active: 'success',
  expiring_soon: 'warning',
  expired: 'danger',
  renewal_in_progress: 'info',
  closed: 'neutral',
};

const day = (d: string | null) => (d ? formatLocalDate(d as LocalDate) : '—');

/** The project's register of subcontractor insurance certificates and bonds, with Nova's rule-based flags. */
export function InsuranceScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const canManage =
    org.role === 'owner' ||
    org.role === 'admin' ||
    atLeast(perms.data?.toolLevels.inspections, 'admin');
  const [params, setParams] = useUrlState(['status', 'kind', 'company'] as const);
  const status = STATUSES.includes(params.status as CoverStatus)
    ? (params.status as CoverStatus)
    : undefined;
  const kind = KINDS.includes(params.kind as CoverKind) ? (params.kind as CoverKind) : undefined;
  const company = dir.companies.some((c) => c.id === params.company) ? params.company : undefined;
  const list = useCoverList({ status, kind, companyId: company });
  const flags = useCoverFlags();
  const reqs = useCoverRequirements();
  const m = useCoverMutations();
  const [editing, setEditing] = useState<Cover | 'new' | null>(null);
  const [renewing, setRenewing] = useState<Cover | null>(null);
  const [expecting, setExpecting] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'insurance', id: 'register' },
  });

  const act = (p: Cover, action: CoverAction) =>
    action === 'markRenewed'
      ? setRenewing(p)
      : m.transition.mutate({ cover: p, input: { action } });

  const columns: DataTableColumn<Cover>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (p) => p.numberLabel,
      cell: (p) => p.numberLabel,
    },
    {
      id: 'title',
      header: 'Certificate or bond',
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
      id: 'company',
      header: 'Company',
      sortValue: (p) => dir.companyName(p.companyId),
      cell: (p) => dir.companyName(p.companyId),
    },
    {
      id: 'issuer',
      header: 'Issued by',
      sortValue: (p) => p.issuer,
      cell: (p) => p.issuer ?? '—',
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'end',
      sortValue: (p) => p.amountCents,
      cell: (p) => formatMoney(p.amountCents),
    },
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
            cell: (p: Cover) => (
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
          } satisfies DataTableColumn<Cover>,
        ]
      : []),
  ];

  const filtered = Boolean(status || kind || company);
  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Insurance and bonds"
        description="Certificates of currency and bonds for each subcontractor on this project. Nova flags what is expiring, expired or missing, and an expired item stops that company at the site clearance check. A company's own documents live in its compliance wallet."
        actions={
          canManage ? (
            <>
              <Button variant="secondary" onClick={() => setExpecting(true)}>
                Required cover
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus size={16} aria-hidden="true" /> Add certificate or bond
              </Button>
            </>
          ) : null
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Insurance and bonds" /> : null}
      <ErrorAlert error={m.transition.error} title="We couldn't update that cover" />
      {(flags.data ?? []).length > 0 ? (
        <Card title="Needs attention" actions={<StatusPill tone="ai">Nova flags</StatusPill>}>
          <ul className="plain-list">
            {(flags.data ?? []).map((f, i) => {
              const target = f.coverId ? list.data?.find((p) => p.id === f.coverId) : undefined;
              return (
                <li key={`${f.kind}-${f.coverId ?? f.coverKind ?? i}`}>
                  <Alert
                    tone={f.severity === 'high' ? 'danger' : 'warning'}
                    title={f.title}
                    action={
                      canManage && target && f.kind === 'expiring' ? (
                        <Button variant="secondary" onClick={() => act(target, 'startRenewal')}>
                          Start renewal
                        </Button>
                      ) : canManage && f.kind === 'missing' ? (
                        <Button variant="secondary" onClick={() => setEditing('new')}>
                          Add certificate or bond
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
      <FilterBar label="Filter insurance and bonds">
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Company"
          value={params.company}
          placeholder="Any company"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setParams({ company: e.target.value })}
        />
        <Select
          label="Type"
          value={params.kind}
          placeholder="Any type"
          options={KINDS.map((v) => ({ value: v, label: KIND_LABELS[v] }))}
          onChange={(e) => setParams({ kind: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load insurance and bonds" />
      {list.isPending ? (
        <SkeletonRows label="Loading insurance and bonds…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={InsuranceIcon}
          title={filtered ? 'Nothing matches' : 'No insurance or bonds on the register'}
          description={
            filtered
              ? 'Try different filters.'
              : 'Add each subcontractor’s certificates of currency and bonds. Nova will flag them before they expire.'
          }
        />
      ) : (
        <DataTable
          caption="Insurance and bonds"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(p) => p.id}
        />
      )}
      {editing ? (
        <CoverDialog
          cover={editing === 'new' ? null : editing}
          dir={dir}
          pending={m.create.isPending || m.update.isPending}
          error={m.create.error ?? m.update.error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === 'new'
              ? m.create.mutate(input, { onSuccess: () => setEditing(null) })
              : m.update.mutate({ cover: editing, input }, { onSuccess: () => setEditing(null) })
          }
        />
      ) : null}
      {renewing ? (
        <RenewedDialog
          cover={renewing}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setRenewing(null)}
          onSave={(newExpiresOn) =>
            m.transition.mutate(
              { cover: renewing, input: { action: 'markRenewed', newExpiresOn } },
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

function CoverDialog({
  cover,
  dir,
  pending,
  error,
  onClose,
  onSave,
}: {
  cover: Cover | null;
  dir: ReturnType<typeof useProjectDirectory>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: CoverInput) => void;
}) {
  const [kind, setKind] = useState<CoverKind>(cover?.kind ?? 'public_liability');
  const [title, setTitle] = useState(cover?.title ?? '');
  const [issuer, setIssuer] = useState(cover?.issuer ?? '');
  const [amount, setAmount] = useState(centsToDollars(cover?.amountCents ?? null));
  const [reference, setReference] = useState(cover?.referenceNumber ?? '');
  const [companyId, setCompanyId] = useState(cover?.companyId ?? '');
  const [issued, setIssued] = useState(cover?.issuedOn ?? '');
  const [expires, setExpires] = useState(cover?.expiresOn ?? '');
  const [notes, setNotes] = useState(cover?.notes ?? '');
  const backwards = Boolean(issued && expires && issued > expires);
  return (
    <Dialog
      open
      onClose={onClose}
      title={cover ? `Edit ${cover.numberLabel}` : 'Add certificate or bond'}
      description="Record what the insurer or bond issuer gave you. Archova keeps the dates and reminds you before it runs out; it doesn't check the certificate with the insurer or bank."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !companyId || backwards || pending}
            onClick={() =>
              onSave({
                kind,
                title: title.trim(),
                companyId,
                issuer: issuer.trim() || null,
                referenceNumber: reference.trim() || null,
                amountCents: dollarsToCents(amount),
                issuedOn: issued || null,
                expiresOn: expires || null,
                notes: notes.trim() || null,
              })
            }
          >
            {pending ? 'Saving…' : cover ? 'Save changes' : 'Add to register'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Type"
          value={kind}
          options={KINDS.map((v) => ({ value: v, label: KIND_LABELS[v] }))}
          onChange={(e) => setKind(e.target.value as CoverKind)}
        />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Insurer or bond issuer"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
        />
        <TextField
          label={categoryOf(kind) === 'bond' ? 'Bond value ($)' : 'Sum insured ($)'}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          label="Reference number"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Select
          label="Company"
          value={companyId}
          placeholder="Choose a company"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompanyId(e.target.value)}
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
        <ErrorAlert error={error} title="We couldn't save the cover" />
      </div>
    </Dialog>
  );
}

function RenewedDialog({
  cover,
  pending,
  error,
  onClose,
  onSave,
}: {
  cover: Cover;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (newExpiresOn: string) => void;
}) {
  const [date, setDate] = useState('');
  const tooEarly = Boolean(date && cover.expiresOn && date <= cover.expiresOn);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mark ${cover.numberLabel} renewed`}
      description={`Currently expires ${day(cover.expiresOn)}. Reminders start again from the new date.`}
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
        <ErrorAlert error={error} title="We couldn't renew the cover" />
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
  type Pick = { leadDays: number; min: string };
  const [picked, setPicked] = useState<Map<CoverKind, Pick>>(
    () =>
      new Map(
        current.map((r) => [
          r.kind,
          { leadDays: r.leadDays, min: centsToDollars(r.minAmountCents) },
        ]),
      ),
  );
  const toggle = (k: CoverKind) =>
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(k)) next.delete(k);
      else next.set(k, { leadDays: 30, min: '' });
      return next;
    });
  const edit = (k: CoverKind, patch: Partial<Pick>) =>
    setPicked((cur) => new Map(cur).set(k, { ...cur.get(k)!, ...patch }));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Required cover"
      description="Every company you track here is expected to hold these. Nova flags one that is missing, expired or under the minimum, and the site clearance check blocks a company with a missing or expired one. Warns this many days before each expires."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSave(
                [...picked].map(([kind, v]) => ({
                  kind,
                  leadDays: v.leadDays,
                  minAmountCents: dollarsToCents(v.min),
                })),
              )
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Button
          variant="secondary"
          onClick={() =>
            setPicked(
              new Map(SUGGESTED_REQUIREMENTS.map((k) => [k, { leadDays: 30, min: '' }] as const)),
            )
          }
        >
          Use the suggested set for a subcontract
        </Button>
        <fieldset className="stack">
          <legend>Expect from each company</legend>
          {KINDS.filter((k) => !k.startsWith('other')).map((k) => (
            <div key={k} className="row-end">
              <label>
                <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />{' '}
                {KIND_LABELS[k]}
              </label>
              {picked.has(k) ? (
                <>
                  <TextField
                    label={`Minimum amount ($), ${KIND_LABELS[k]}`}
                    inputMode="decimal"
                    value={picked.get(k)!.min}
                    onChange={(e) => edit(k, { min: e.target.value })}
                  />
                  <TextField
                    label={`Warn days before expiry, ${KIND_LABELS[k]}`}
                    type="number"
                    min={1}
                    max={365}
                    value={String(picked.get(k)!.leadDays)}
                    onChange={(e) =>
                      edit(k, { leadDays: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })
                    }
                  />
                </>
              ) : null}
            </div>
          ))}
        </fieldset>
        <ErrorAlert error={error} title="We couldn't save the required cover" />
      </div>
    </Dialog>
  );
}
