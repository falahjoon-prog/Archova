'use client';

import { useEffect, useRef, useState } from 'react';
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
import { DeclarationsIcon, Plus } from '@archova/ui/icons';
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
  useDeclarationClaims,
  useDeclarationFlags,
  useDeclarationList,
  useDeclarationMutations,
  useDeclarationRequirements,
} from '../hooks/useDeclarations';
import {
  DEFAULT_LEAD_DAYS,
  GATE_LABELS,
  KINDS,
  KIND_HELP,
  KIND_LABELS,
  STATUSES,
  STATUS_LABELS,
  type ClaimStatus,
  type Declaration,
  type DeclarationInput,
  type DeclarationKind,
  type DeclarationStatus,
  type GateState,
  type Reading,
  type Requirement,
} from '../lib/types';

const STATUS_TONE: Record<DeclarationStatus, StatusTone> = {
  current: 'success',
  expiring_soon: 'warning',
  expired: 'danger',
  not_yet_valid: 'info',
  rejected: 'danger',
};
const GATE_TONE: Record<GateState, StatusTone> = {
  cleared: 'success',
  warning: 'warning',
  blocked: 'danger',
};

const day = (d: string | null) => (d ? formatLocalDate(d as LocalDate) : '—');

/**
 * Subcontractor statutory declarations: the workers' compensation, payroll tax and wages declarations a builder
 * collects with each payment claim. Shows where each open claim stands, what Nova flags, and the register. It records
 * what was received; it never says a declaration is genuine, and it never suggests withholding payment.
 */
export function DeclarationsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const canManage =
    org.role === 'owner' ||
    org.role === 'admin' ||
    atLeast(perms.data?.toolLevels.inspections, 'admin');
  const [params, setParams] = useUrlState(['status', 'kind', 'company'] as const);
  const status = STATUSES.includes(params.status as DeclarationStatus)
    ? (params.status as DeclarationStatus)
    : undefined;
  const kind = KINDS.includes(params.kind as DeclarationKind)
    ? (params.kind as DeclarationKind)
    : undefined;
  const company = dir.companies.some((c) => c.id === params.company) ? params.company : undefined;
  const list = useDeclarationList({ status, kind, companyId: company });
  const flags = useDeclarationFlags();
  const claims = useDeclarationClaims();
  const reqs = useDeclarationRequirements();
  const m = useDeclarationMutations();
  const [editing, setEditing] = useState<Declaration | 'new' | null>(null);
  const [rejecting, setRejecting] = useState<Declaration | null>(null);
  const [requiring, setRequiring] = useState(false);
  const [chasing, setChasing] = useState<{ companyId: string; claim?: ClaimStatus } | null>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'declarations', id: 'register' },
  });

  const claimColumns: DataTableColumn<ClaimStatus>[] = [
    {
      id: 'claim',
      header: 'Claim',
      rowHeader: true,
      sortValue: (c) => c.number,
      cell: (c) => (
        <>
          Claim {c.number}
          <div className="u-muted">{c.contractTitle}</div>
        </>
      ),
    },
    {
      id: 'company',
      header: 'Subcontractor',
      sortValue: (c) => c.companyName,
      cell: (c) => c.companyName,
    },
    {
      id: 'period',
      header: 'Period ends',
      sortValue: (c) => c.periodEnd,
      cell: (c) => day(c.periodEnd),
    },
    {
      id: 'state',
      header: 'Declarations',
      sortValue: (c) => c.state,
      cell: (c) => (
        <>
          <StatusPill tone={GATE_TONE[c.state]}>{GATE_LABELS[c.state]}</StatusPill>
          {c.coveredByStatement ? (
            <div className="u-muted">Covered by the subcontractor’s statement</div>
          ) : null}
        </>
      ),
    },
    {
      id: 'missing',
      header: 'What is needed',
      cell: (c) =>
        c.issues.length === 0 ? (
          '—'
        ) : (
          <ul className="plain-list">
            {c.issues.map((i) => (
              <li key={`${i.declarationKind}-${i.kind}`}>{i.message}</li>
            ))}
          </ul>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (c: ClaimStatus) =>
              c.state === 'blocked' ? (
                <Button
                  variant="secondary"
                  aria-label={`Chase ${c.companyName} for claim ${c.number}`}
                  onClick={() => setChasing({ companyId: c.companyId, claim: c })}
                >
                  Chase
                </Button>
              ) : null,
          } satisfies DataTableColumn<ClaimStatus>,
        ]
      : []),
  ];

  const columns: DataTableColumn<Declaration>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (d) => d.numberLabel,
      cell: (d) => d.numberLabel,
    },
    {
      id: 'company',
      header: 'Company',
      sortValue: (d) => dir.companyName(d.companyId),
      cell: (d) => dir.companyName(d.companyId),
    },
    {
      id: 'kind',
      header: 'Declaration',
      sortValue: (d) => d.kind,
      cell: (d) => KIND_LABELS[d.kind],
    },
    {
      id: 'covers',
      header: 'Covers',
      sortValue: (d) => d.validTo,
      cell: (d) => (
        <>
          {day(d.validFrom)} to {day(d.validTo)}
          {d.status !== 'rejected' && d.daysToEnd >= 0 && d.status === 'expiring_soon' ? (
            <div className="u-muted">
              {d.daysToEnd === 0
                ? 'ends today'
                : `ends in ${d.daysToEnd} day${d.daysToEnd === 1 ? '' : 's'}`}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'declarant',
      header: 'Declared by',
      sortValue: (d) => d.declarantName,
      cell: (d) => (
        <>
          {d.declarantName ?? '—'}
          {d.declarantPosition ? <div className="u-muted">{d.declarantPosition}</div> : null}
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (d) => d.status,
      cell: (d) => (
        <>
          <StatusPill tone={STATUS_TONE[d.status]}>{STATUS_LABELS[d.status]}</StatusPill>
          {d.readByNova ? <div className="u-muted">Read by Nova, checked by a person</div> : null}
        </>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (d: Declaration) => (
              <span className="row-actions">
                {d.lifecycle === 'rejected' ? (
                  <Button
                    variant="tertiary"
                    disabled={m.transition.isPending}
                    aria-label={`Accept ${d.numberLabel}`}
                    onClick={() =>
                      m.transition.mutate({ declaration: d, input: { action: 'accept' } })
                    }
                  >
                    Accept
                  </Button>
                ) : (
                  <Button
                    variant="tertiary"
                    aria-label={`Reject ${d.numberLabel}`}
                    onClick={() => setRejecting(d)}
                  >
                    Reject
                  </Button>
                )}
                <Button
                  variant="tertiary"
                  aria-label={`Edit ${d.numberLabel}`}
                  onClick={() => setEditing(d)}
                >
                  Edit
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<Declaration>,
        ]
      : []),
  ];

  const filtered = Boolean(status || kind || company);
  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Subcontractor declarations"
        description="The workers' compensation, payroll tax and wages declarations each subcontractor gives with a payment claim. Archova records what you received and the dates it covers, flags what is missing, and Nova chases it and reads uploaded certificates. It does not check a declaration with the insurer or revenue office."
        actions={
          canManage ? (
            <>
              <Button variant="secondary" onClick={() => setRequiring(true)}>
                Required declarations
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus size={16} aria-hidden="true" /> Record a declaration
              </Button>
            </>
          ) : null
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Subcontractor declarations" /> : null}
      <ErrorAlert error={m.transition.error} title="We couldn't update that declaration" />

      <Card title="Open subcontract claims">
        <ErrorAlert error={claims.error} title="We couldn't load the claims" />
        {claims.isPending ? (
          <SkeletonRows label="Loading claims…" />
        ) : !claims.data?.requirementsSet ? (
          <Alert
            tone="info"
            title="This project hasn’t chosen which declarations it needs"
            action={
              canManage ? (
                <Button variant="secondary" onClick={() => setRequiring(true)}>
                  Choose required declarations
                </Button>
              ) : undefined
            }
          >
            Once it has, each open claim shows what is still needed, and issuing a payment schedule
            for money with one missing asks for an acknowledgement. Until then nothing is checked.
          </Alert>
        ) : claims.data.data.length === 0 ? (
          <EmptyState
            icon={DeclarationsIcon}
            title="No open subcontract claims"
            description="Claims that are waiting for a payment schedule show here with what each still needs."
          />
        ) : (
          <DataTable
            caption="Open subcontract claims and their declarations"
            columns={claimColumns}
            rows={claims.data.data}
            getRowId={(c) => c.claimId}
          />
        )}
      </Card>

      {(flags.data ?? []).length > 0 ? (
        <Card title="Needs attention" actions={<StatusPill tone="ai">Nova flags</StatusPill>}>
          <ul className="plain-list">
            {(flags.data ?? []).map((f, i) => (
              <li key={`${f.kind}-${f.declarationId ?? f.declarationKind}-${f.companyId}-${i}`}>
                <Alert
                  tone={f.severity === 'high' ? 'danger' : 'warning'}
                  title={f.title}
                  action={
                    canManage ? (
                      <Button
                        variant="secondary"
                        onClick={() => setChasing({ companyId: f.companyId })}
                      >
                        Chase
                      </Button>
                    ) : undefined
                  }
                >
                  {f.detail}
                </Alert>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <FilterBar label="Filter declarations">
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
          label="Declaration"
          value={params.kind}
          placeholder="Any declaration"
          options={KINDS.map((v) => ({ value: v, label: KIND_LABELS[v] }))}
          onChange={(e) => setParams({ kind: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load the declarations" />
      {list.isPending ? (
        <SkeletonRows label="Loading declarations…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={DeclarationsIcon}
          title={filtered ? 'Nothing matches' : 'No declarations on the register'}
          description={
            filtered
              ? 'Try different filters.'
              : 'Record each declaration as it arrives, or upload the PDF and let Nova read the dates for you to check.'
          }
        />
      ) : (
        <DataTable
          caption="Subcontractor declarations"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(d) => d.id}
        />
      )}

      {editing ? (
        <DeclarationDialog
          declaration={editing === 'new' ? null : editing}
          dir={dir}
          reader={m.read}
          pending={m.create.isPending || m.update.isPending}
          error={m.create.error ?? m.update.error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === 'new'
              ? m.create.mutate(input, { onSuccess: () => setEditing(null) })
              : m.update.mutate(
                  { declaration: editing, input },
                  { onSuccess: () => setEditing(null) },
                )
          }
        />
      ) : null}
      {rejecting ? (
        <RejectDialog
          declaration={rejecting}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setRejecting(null)}
          onSave={(note) =>
            m.transition.mutate(
              { declaration: rejecting, input: { action: 'reject', note } },
              { onSuccess: () => setRejecting(null) },
            )
          }
        />
      ) : null}
      {requiring ? (
        <RequiredDialog
          current={reqs.data ?? []}
          pending={m.setRequirements.isPending}
          error={m.setRequirements.error}
          onClose={() => setRequiring(false)}
          onSave={(items) =>
            m.setRequirements.mutate(items, { onSuccess: () => setRequiring(false) })
          }
        />
      ) : null}
      {chasing ? (
        <ChaseDialog
          target={chasing}
          companyName={dir.companyName(chasing.companyId)}
          chase={m.chase}
          onClose={() => setChasing(null)}
        />
      ) : null}
    </>
  );
}

type Dir = ReturnType<typeof useProjectDirectory>;
type ReadMutation = ReturnType<typeof useDeclarationMutations>['read'];

function DeclarationDialog({
  declaration,
  dir,
  reader,
  pending,
  error,
  onClose,
  onSave,
}: {
  declaration: Declaration | null;
  dir: Dir;
  reader: ReadMutation;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: DeclarationInput) => void;
}) {
  const [kind, setKind] = useState<DeclarationKind>(declaration?.kind ?? 'workers_comp');
  const [companyId, setCompanyId] = useState(declaration?.companyId ?? '');
  const [from, setFrom] = useState(declaration?.validFrom ?? '');
  const [to, setTo] = useState(declaration?.validTo ?? '');
  const [name, setName] = useState(declaration?.declarantName ?? '');
  const [position, setPosition] = useState(declaration?.declarantPosition ?? '');
  const [declaredOn, setDeclaredOn] = useState(declaration?.declaredOn ?? '');
  const [issuer, setIssuer] = useState(declaration?.issuer ?? '');
  const [reference, setReference] = useState(declaration?.referenceNumber ?? '');
  const [notes, setNotes] = useState(declaration?.notes ?? '');
  const [reading, setReading] = useState<Reading | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const backwards = Boolean(from && to && from > to);

  const apply = (r: Reading) => {
    setReading(r);
    // Nova fills only what it could check against the page; the person confirms every value before saving.
    if (r.kind) setKind(r.kind);
    if (r.validFrom) setFrom(r.validFrom);
    if (r.validTo) setTo(r.validTo);
    if (r.declarantName) setName(r.declarantName);
    if (r.declarantPosition) setPosition(r.declarantPosition);
    if (r.declaredOn) setDeclaredOn(r.declaredOn);
    if (r.issuer) setIssuer(r.issuer);
    if (r.referenceNumber) setReference(r.referenceNumber);
    if (!companyId && r.companyName) {
      const hit = dir.companies.find(
        (c) => dir.onProject(c.id) && c.name.toLowerCase() === r.companyName!.toLowerCase(),
      );
      if (hit) setCompanyId(hit.id);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={declaration ? `Edit ${declaration.numberLabel}` : 'Record a declaration'}
      description="Record what the subcontractor gave you. Archova keeps the dates it covers and checks them against each claim's period; it doesn't confirm the declaration with the insurer or revenue office."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!companyId || !from || !to || backwards || pending}
            onClick={() =>
              onSave({
                kind,
                companyId,
                validFrom: from,
                validTo: to,
                declarantName: name.trim() || null,
                declarantPosition: position.trim() || null,
                declaredOn: declaredOn || null,
                issuer: issuer.trim() || null,
                referenceNumber: reference.trim() || null,
                notes: notes.trim() || null,
                ...(reading ? { fileIds: [reading.fileId], readByNova: true } : {}),
              })
            }
          >
            {pending ? 'Saving…' : declaration ? 'Save changes' : 'Add to register'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {!declaration ? (
          <div className="stack">
            <input
              ref={picker}
              className="u-visually-hidden"
              type="file"
              accept="application/pdf"
              aria-label="Declaration PDF"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) reader.mutate(file, { onSuccess: apply });
                e.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              disabled={reader.isPending}
              onClick={() => picker.current?.click()}
            >
              {reader.isPending ? 'Nova is reading…' : 'Read a PDF with Nova'}
            </Button>
            <ErrorAlert error={reader.error} title="Nova couldn't read that file" />
            {reading ? (
              <Alert
                tone="info"
                title="Nova filled in what it could find. Check it against the PDF."
              >
                <ul className="plain-list">
                  {Object.values(reading.sources).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                  {reading.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </div>
        ) : null}
        <Select
          label="Declaration"
          value={kind}
          options={KINDS.map((v) => ({ value: v, label: KIND_LABELS[v] }))}
          hint={KIND_HELP[kind]}
          onChange={(e) => setKind(e.target.value as DeclarationKind)}
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
          label="Covers from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="Covers to"
          type="date"
          value={to}
          error={backwards ? 'The end date is before the start date.' : undefined}
          onChange={(e) => setTo(e.target.value)}
        />
        <TextField label="Declared by" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Position"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        />
        <TextField
          label="Date declared"
          type="date"
          value={declaredOn}
          onChange={(e) => setDeclaredOn(e.target.value)}
        />
        <TextField
          label={kind === 'workers_comp' ? 'Insurer' : 'Registered with'}
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
        />
        <TextField
          label="Policy or reference number"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the declaration" />
      </div>
    </Dialog>
  );
}

function RejectDialog({
  declaration,
  pending,
  error,
  onClose,
  onSave,
}: {
  declaration: Declaration;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reject ${declaration.numberLabel}`}
      description="A rejected declaration no longer counts for any claim. Say why, so the subcontractor knows what to fix."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!note.trim() || pending} onClick={() => onSave(note.trim())}>
            {pending ? 'Saving…' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't reject the declaration" />
      </div>
    </Dialog>
  );
}

function RequiredDialog({
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
  const [picked, setPicked] = useState<Map<DeclarationKind, number>>(
    () => new Map(current.map((r) => [r.kind, r.leadDays])),
  );
  const toggle = (k: DeclarationKind) =>
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(k)) next.delete(k);
      else next.set(k, DEFAULT_LEAD_DAYS[k]);
      return next;
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Required declarations"
      description="Every subcontract claim is expected to have these. Each open claim shows what is missing, and issuing a payment schedule for money with one missing asks for an acknowledgement. The schedule can always still be issued on time. Choose none to switch the check off."
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
          onClick={() => setPicked(new Map(KINDS.map((k) => [k, DEFAULT_LEAD_DAYS[k]] as const)))}
        >
          Use all three for each subcontract claim
        </Button>
        <fieldset className="stack">
          <legend>Expect with each claim</legend>
          {KINDS.map((k) => (
            <div key={k} className="stack">
              <label>
                <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />{' '}
                {KIND_LABELS[k]}
              </label>
              {picked.has(k) ? (
                <TextField
                  label={`Flag this many days before it ends, ${KIND_LABELS[k]}`}
                  type="number"
                  min={0}
                  max={365}
                  value={String(picked.get(k))}
                  onChange={(e) =>
                    setPicked((cur) =>
                      new Map(cur).set(k, Math.min(365, Math.max(0, Number(e.target.value) || 0))),
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </fieldset>
        <ErrorAlert error={error} title="We couldn't save the required declarations" />
      </div>
    </Dialog>
  );
}

function ChaseDialog({
  target,
  companyName,
  chase,
  onClose,
}: {
  target: { companyId: string; claim?: ClaimStatus };
  companyName: string;
  chase: ReturnType<typeof useDeclarationMutations>['chase'];
  onClose: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [noEmail, setNoEmail] = useState(false);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [nothing, setNothing] = useState(false);
  const base = {
    companyId: target.companyId,
    ...(target.claim ? { claimId: target.claim.claimId } : {}),
  };

  // Nova drafts the email when the dialog opens; nothing is sent until the person presses Send.
  const { mutate } = chase;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate(
      {
        companyId: target.companyId,
        ...(target.claim ? { claimId: target.claim.claimId } : {}),
        send: false,
      },
      {
        onSuccess: (r) => {
          setLoaded(true);
          setRecipient(r.recipient);
          setNoEmail(!r.recipient);
          setNothing(!r.draft);
          if (r.draft) {
            setSubject(r.draft.subject);
            setBody(r.draft.body);
          }
        },
      },
    );
  }, [mutate, target]);
  const sent = chase.data?.sent === true;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Chase ${companyName}`}
      description="Nova drafted this email from what is missing. Read it, change anything you like, then send it. Nothing is sent until you press Send."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </Button>
          {!sent ? (
            <Button
              disabled={
                !loaded || nothing || noEmail || !subject.trim() || !body.trim() || chase.isPending
              }
              onClick={() =>
                chase.mutate({ ...base, send: true, subject: subject.trim(), body: body.trim() })
              }
            >
              {chase.isPending && loaded ? 'Sending…' : 'Send email'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="stack">
        {!loaded && chase.isPending ? <SkeletonRows label="Nova is drafting…" /> : null}
        <ErrorAlert error={chase.error} title="We couldn't prepare or send that email" />
        {nothing ? (
          <Alert tone="success" title="Nothing is missing">
            This company has what the project asks for, so there is nothing to chase.
          </Alert>
        ) : null}
        {noEmail && loaded && !nothing ? (
          <Alert tone="warning" title="No email address on file">
            Add an email to {companyName} in the directory, then chase again.
          </Alert>
        ) : null}
        {sent ? (
          <Alert tone="success" title={`Sent to ${chase.data?.recipient ?? companyName}`}>
            A copy is kept in this company’s chase history.
          </Alert>
        ) : null}
        {loaded && !nothing ? (
          <>
            <TextField label="To" value={recipient ?? ''} readOnly onChange={() => undefined} />
            <TextField
              label="Subject"
              value={subject}
              disabled={sent}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Textarea
              label="Message"
              value={body}
              disabled={sent}
              onChange={(e) => setBody(e.target.value)}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
