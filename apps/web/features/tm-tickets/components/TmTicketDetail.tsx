'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Select,
  StatusPill,
  Textarea,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useBudget } from '@/features/budget';
import { useContracts } from '@/features/claims';
import type { TmTicketDetail } from '../data/api';
import { useTmMutations, useTmTicket } from '../hooks/useTmTickets';
import { aud, KIND_LABEL } from '../lib/tm';

type Line = TmTicketDetail['lines'][number];

export const STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'warning' | 'success' | 'info' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  part_signed: { label: 'Part signed', tone: 'warning' },
  signed: { label: 'Signed', tone: 'success' },
  converted: { label: 'Converted', tone: 'info' },
  void: { label: 'Voided', tone: 'neutral' },
};
const ROLE_LABEL = {
  contractor: 'Contractor',
  principal_rep: 'Principal’s representative',
} as const;

const columns: DataTableColumn<Line>[] = [
  { id: 'kind', header: 'Kind', cell: (l) => KIND_LABEL[l.kind] },
  { id: 'what', header: 'Description', rowHeader: true, cell: (l) => l.description },
  {
    id: 'qty',
    header: 'Quantity',
    align: 'end',
    cell: (l) => (
      <span className="u-mono u-nowrap">
        {l.quantity} {l.unit}
      </span>
    ),
  },
  {
    id: 'rate',
    header: 'Rate',
    align: 'end',
    cell: (l) => <span className="u-mono u-nowrap">{aud(l.rate)}</span>,
  },
  {
    id: 'amount',
    header: 'Amount (ex GST)',
    align: 'end',
    cell: (l) => <span className="u-mono u-nowrap">{aud(l.amount)}</span>,
  },
];

/** One ticket: what was done, who has signed, and the next step (sign, convert or void). */
export function TmTicketDetailCard({
  id,
  canManage,
  canSign,
  canConvert,
  onClose,
}: {
  id: string;
  canManage: boolean;
  canSign: boolean;
  canConvert: boolean;
  onClose: () => void;
}) {
  const project = useCurrentProject();
  const q = useTmTicket(project.projectId, id);
  const { sign, convert, voidTicket } = useTmMutations(project.projectId);
  const budget = useBudget(project.projectId);
  const contracts = useContracts(project.projectId);
  const [signerName, setSignerName] = useState('');
  const [position, setPosition] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);
  const [role, setRole] = useState<'contractor' | 'principal_rep'>('contractor');
  const [target, setTarget] = useState<'direct_cost' | 'variation'>('direct_cost');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [contractId, setContractId] = useState('');
  const [note, setNote] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.error) return <ErrorAlert error={q.error} title="We couldn't load that ticket" />;
  const t = q.data;
  if (!t) return null;
  const st = STATUS[t.status]!;
  const signedRoles = t.signoffs.map((s) => s.role);
  const activeRole: 'contractor' | 'principal_rep' = signedRoles.includes(role)
    ? role === 'contractor'
      ? 'principal_rep'
      : 'contractor'
    : role;
  const open = t.status === 'draft' || t.status === 'part_signed';

  function doSign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signerName.trim()) return setError('Type the signer’s full name.');
    if (activeRole === 'principal_rep' && !evidence)
      return setError(
        'Attach a photo of the docket signed on site by the principal’s representative.',
      );
    sign.mutate({
      id,
      body: {
        role: activeRole,
        signerName: signerName.trim(),
        ...(position.trim() ? { signerPosition: position.trim() } : {}),
        ...(evidence ? { evidence } : {}),
      },
    });
  }
  function doConvert(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (target === 'direct_cost' && !budgetLineId)
      return setError('Choose the budget line to post the costs to.');
    if (target === 'variation' && !contractId)
      return setError('Choose the contract to raise the variation on.');
    convert.mutate({
      id,
      body: target === 'direct_cost' ? { to: target, budgetLineId } : { to: target, contractId },
    });
  }
  function doVoid(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return setError('Give the reason for voiding this ticket.');
    setError(null);
    voidTicket.mutate(
      { id, note: note.trim() },
      {
        onSuccess: () => {
          setVoiding(false);
          setNote('');
        },
      },
    );
  }

  return (
    <Card
      title={`T&M-${t.number}: ${t.title}`}
      actions={
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack-lg">
        <p className="u-m-0">
          <StatusPill tone={st.tone}>{st.label}</StatusPill>{' '}
          {t.origin === 'nova' ? <StatusPill tone="ai">Drafted by Nova</StatusPill> : null}
        </p>
        <p className="u-m-0 u-caption">
          {[
            formatLocalDate(t.workDate),
            t.location,
            t.contractor,
            t.instructedBy && `Instructed by ${t.instructedBy}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {t.description ? <p className="u-m-0">{t.description}</p> : null}
        <DataTable
          caption="Ticket lines"
          columns={columns}
          rows={t.lines}
          getRowId={(l) => `${l.kind}-${l.description}-${l.sourceId ?? ''}`}
        />
        <p className="u-m-0">
          <strong className="u-mono">Total {aud(t.total)}</strong> ex GST
        </p>

        <section aria-label="Signatures" className="stack-md">
          <h3 className="u-m-0">Signatures</h3>
          {t.signoffs.length === 0 ? <p className="u-m-0">Not signed yet.</p> : null}
          {t.signoffs.map((s) => (
            <p key={s.role} className="u-m-0">
              {ROLE_LABEL[s.role]}: signed on site by {s.signerName}
              {s.signerPosition ? `, ${s.signerPosition}` : ''} ·{' '}
              {formatLocalDate(s.signedAt.slice(0, 10))}
              <span className="u-caption">
                {' '}
                · recorded by builder staff{s.hasEvidence ? ', docket photo attached' : ''} ·
                fingerprint {s.contentHash.slice(0, 12)}
              </span>
            </p>
          ))}
          {open && canSign ? (
            <form className="stack-md" onSubmit={doSign} noValidate>
              <p className="u-caption u-m-0">
                Record a signature given on site. Once recorded the lines are locked, and it is
                logged against you as the person who entered it. The second must be recorded by a
                different staff member, and the principal’s representative’s needs a photo of the
                signed docket.
              </p>
              <div className="form-row">
                <Select
                  label="Signing as"
                  options={(['contractor', 'principal_rep'] as const)
                    .filter((r) => !signedRoles.includes(r))
                    .map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  value={activeRole}
                  onChange={(e) => setRole(e.target.value as typeof role)}
                />
                <TextField
                  label="Full name"
                  required
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
                <TextField
                  label="Position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>
              {activeRole === 'principal_rep' ? (
                <div>
                  <label htmlFor="tm-evidence">Photo of the docket signed on site</label>
                  <input
                    id="tm-evidence"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
                  />
                </div>
              ) : null}
              <div className="row-actions">
                <Button type="submit" disabled={sign.isPending}>
                  {sign.isPending ? 'Signing…' : 'Record signature'}
                </Button>
              </div>
            </form>
          ) : null}
        </section>

        {t.status === 'signed' && canConvert ? (
          <form className="stack-md" onSubmit={doConvert} noValidate>
            <h3 className="u-m-0">Convert</h3>
            <p className="u-caption u-m-0">
              Post the cost to a budget line (one direct cost each for labour, plant and materials),
              or raise a draft variation to claim it. This can only be done once.
            </p>
            <div className="form-row">
              <Select
                label="Convert to"
                options={[
                  { value: 'direct_cost', label: 'Direct costs' },
                  { value: 'variation', label: 'Draft variation' },
                ]}
                value={target}
                onChange={(e) => setTarget(e.target.value as typeof target)}
              />
              {target === 'direct_cost' ? (
                <Select
                  label="Budget line"
                  placeholder="Choose a budget line"
                  options={(budget.data?.lines ?? []).map((l) => ({
                    value: l.id,
                    label: `${l.code} ${l.codeDescription}`,
                  }))}
                  value={budgetLineId}
                  onChange={(e) => setBudgetLineId(e.target.value)}
                />
              ) : (
                <Select
                  label="Contract"
                  placeholder="Choose a contract"
                  options={(contracts.data ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.number}. ${c.title}`,
                  }))}
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                />
              )}
            </div>
            <div className="row-actions">
              <Button type="submit" disabled={convert.isPending}>
                {convert.isPending ? 'Converting…' : 'Convert ticket'}
              </Button>
            </div>
          </form>
        ) : null}
        {t.status === 'converted' ? (
          <p className="u-m-0">
            Converted to {t.convertedTo === 'variation' ? 'a draft variation' : 'direct costs'}.
          </p>
        ) : null}
        {t.status === 'void' && t.voidReason ? (
          <Alert tone="info">Voided: {t.voidReason}</Alert>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={sign.error} title="We couldn't sign this ticket" />
        <ErrorAlert error={convert.error} title="We couldn't convert this ticket" />
        <ErrorAlert error={voidTicket.error} title="We couldn't void this ticket" />

        {canManage && t.status !== 'void' && t.status !== 'converted' ? (
          voiding ? (
            <form className="stack-md" onSubmit={doVoid} noValidate>
              <Textarea
                label="Reason for voiding"
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="row-actions">
                <Button type="submit" disabled={voidTicket.isPending}>
                  Confirm void
                </Button>
                <Button variant="secondary" onClick={() => setVoiding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="row-actions">
              <Button size="sm" variant="secondary" onClick={() => setVoiding(true)}>
                Void ticket
              </Button>
            </div>
          )
        ) : null}
      </div>
    </Card>
  );
}
