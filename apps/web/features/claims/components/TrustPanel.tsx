'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  Select,
  StatusPill,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ContractTrust, TrustMovement, TrustStatus } from '../data/api';
import { useTrustMutations } from '../hooks/useClaims';
import { TRUST_MOVEMENT_LABELS, TRUST_STATUS_LABELS } from '../lib/deadline';
import { aud, cents } from '../lib/money';

const TONE: Record<TrustStatus, StatusTone> = {
  not_required: 'neutral',
  not_set_up: 'warning',
  ok: 'success',
  shortfall: 'danger',
};

/** Retention trust record: shown to everyone who can see the contract, edited only by builder staff. */
export function TrustPanel({
  contractId,
  trust,
  canManage,
}: {
  contractId: string;
  trust: ContractTrust;
  canManage: boolean;
}) {
  const p = trust.position;
  const columns: DataTableColumn<TrustMovement>[] = [
    { id: 'date', header: 'Date', cell: (m) => formatLocalDate(m.movedOn) },
    { id: 'kind', header: 'Type', cell: (m) => TRUST_MOVEMENT_LABELS[m.kind] },
    { id: 'ref', header: 'Reference', rowHeader: true, cell: (m) => m.reference },
    {
      id: 'amount',
      header: 'Amount',
      align: 'end',
      cell: (m) => <span className="u-mono">{aud(m.amount)}</span>,
    },
  ];
  return (
    <div className="stack-lg">
      <Card
        title="Retention trust"
        actions={<StatusPill tone={TONE[p.status]}>{TRUST_STATUS_LABELS[p.status]}</StatusPill>}
      >
        <p className="u-m-0">{trust.requirement.basis}</p>
        {!trust.requirement.rulesReviewed ? (
          <Alert tone="info" title="Rules not yet legally reviewed">
            These thresholds are a guide only. Check them with your lawyer before relying on them.
          </Alert>
        ) : null}
        <DescriptionList
          items={[
            { label: 'Retention withheld', value: aud(p.retentionWithheld), mono: true },
            { label: 'Released to payee', value: aud(p.released), mono: true },
            { label: 'Should be in trust', value: aud(p.requiredInTrust), mono: true },
            { label: 'Held in trust', value: aud(p.balance), mono: true },
            ...(p.shortfall !== '0.00'
              ? [{ label: 'Shortfall', value: aud(p.shortfall), mono: true }]
              : []),
            ...(trust.account?.institution
              ? [
                  {
                    label: 'Account',
                    value: `${trust.account.institution}${trust.account.accountLast4 ? ` ending ${trust.account.accountLast4}` : ''}`,
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <DataTable
        caption="Trust account movements"
        columns={columns}
        rows={trust.movements}
        getRowId={(m) => m.id}
        empty={<p className="u-m-0">No money has been recorded in or out of the trust yet.</p>}
      />
      {canManage ? (
        <>
          <Card title="Trust account details">
            <TrustProfileForm contractId={contractId} trust={trust} />
          </Card>
          <Card title="Record a trust movement">
            <MovementForm contractId={contractId} trust={trust} />
          </Card>
        </>
      ) : null}
    </div>
  );
}

function TrustProfileForm({ contractId, trust }: { contractId: string; trust: ContractTrust }) {
  const project = useCurrentProject();
  const { saveTrust } = useTrustMutations(project.projectId, contractId);
  const a = trust.account;
  const [institution, setInstitution] = useState(a?.institution ?? '');
  const [accountName, setAccountName] = useState(a?.accountName ?? '');
  const [last4, setLast4] = useState(a?.accountLast4 ?? '');
  const [openedOn, setOpenedOn] = useState(a?.openedOn ?? '');
  const [government, setGovernment] = useState(a?.governmentClient ?? false);
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!institution.trim()) return setError('Enter the bank or institution holding the trust.');
    if (last4 && !/^\d{4}$/.test(last4))
      return setError('Enter just the last four digits of the account number.');
    saveTrust.mutate({
      governmentClient: government,
      institution: institution.trim(),
      accountName: accountName.trim() || null,
      accountLast4: last4 || null,
      openedOn: openedOn || null,
    });
  }
  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      <TextField
        label="Bank or institution"
        value={institution}
        onChange={(e) => setInstitution(e.target.value)}
      />
      <TextField
        label="Account name"
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
      />
      <TextField
        label="Last four digits of the account number"
        inputMode="numeric"
        maxLength={4}
        value={last4}
        hint="We never store the full account number."
        onChange={(e) => setLast4(e.target.value)}
      />
      <TextField
        label="Opened on"
        type="date"
        value={openedOn}
        onChange={(e) => setOpenedOn(e.target.value)}
      />
      <label className="row-actions">
        <input
          type="checkbox"
          checked={government}
          onChange={(e) => setGovernment(e.target.checked)}
        />
        The client is a government body
      </label>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={saveTrust.error} title="We couldn't save the trust details" />
      <div className="row-actions">
        <Button type="submit" disabled={saveTrust.isPending}>
          {saveTrust.isPending ? 'Saving…' : 'Save trust details'}
        </Button>
      </div>
    </form>
  );
}

function MovementForm({ contractId, trust }: { contractId: string; trust: ContractTrust }) {
  const project = useCurrentProject();
  const { recordMovement } = useTrustMutations(project.projectId, contractId);
  const [kind, setKind] = useState<'deposit' | 'interest' | 'release' | 'reversal'>('deposit');
  const [amount, setAmount] = useState('');
  const [movedOn, setMovedOn] = useState('');
  const [reference, setReference] = useState('');
  const [reverses, setReverses] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reversible = trust.movements.filter(
    (m) => m.kind !== 'reversal' && !trust.movements.some((r) => r.reversesMovementId === m.id),
  );

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!trust.account?.institution) return setError('Save the trust account details first.');
    const c = cents(amount);
    if (c === null || c === 0)
      return setError('Enter the amount as a dollar amount, like 5000.00.');
    if (!movedOn) return setError('Enter the date the money moved.');
    if (!reference.trim()) return setError('Enter a reference, like the bank transaction number.');
    if (kind === 'reversal' && !reverses) return setError('Choose the movement to reverse.');
    recordMovement.mutate(
      {
        kind,
        amount: amount.trim(),
        movedOn,
        reference: reference.trim(),
        ...(kind === 'reversal' ? { reversesMovementId: reverses } : {}),
      },
      {
        onSuccess: () => {
          setAmount('');
          setReference('');
          setReverses('');
        },
      },
    );
  }
  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      <Select
        label="Type"
        value={kind}
        options={Object.entries(TRUST_MOVEMENT_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      />
      {kind === 'reversal' ? (
        <Select
          label="Movement to reverse"
          value={reverses}
          placeholder="Choose a movement"
          options={reversible.map((m) => ({
            value: m.id,
            label: `${TRUST_MOVEMENT_LABELS[m.kind]} ${aud(m.amount)} (${m.reference})`,
          }))}
          onChange={(e) => setReverses(e.target.value)}
        />
      ) : null}
      <TextField
        label="Amount"
        inputMode="decimal"
        value={amount}
        hint="Enter a positive amount. A release is taken out of the trust."
        onChange={(e) => setAmount(e.target.value)}
      />
      <TextField
        label="Date"
        type="date"
        value={movedOn}
        onChange={(e) => setMovedOn(e.target.value)}
      />
      <TextField
        label="Reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={recordMovement.error} title="We couldn't record this movement" />
      <div className="row-actions">
        <Button type="submit" disabled={recordMovement.isPending}>
          {recordMovement.isPending ? 'Recording…' : 'Record movement'}
        </Button>
      </div>
    </form>
  );
}
