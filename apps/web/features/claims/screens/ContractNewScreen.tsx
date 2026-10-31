'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, PageHeader, Select, TextField } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { CreateContract } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { aud, cents } from '../lib/money';

const STATES = ['NSW', 'VIC', 'QLD'] as const;
type Row = { code: string; description: string; value: string };

/** Sets up a contract and its schedule of values. The schedule must add up to the contract value (CLM-US1). */
export function ContractNewScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'contracts', id: 'new' },
  });
  const { createContract } = useClaimsMutations(project.projectId);
  const [kind, setKind] = useState<'head' | 'subcontract'>('subcontract');
  const [title, setTitle] = useState('');
  const [payee, setPayee] = useState('');
  const [value, setValue] = useState('');
  const [retention, setRetention] = useState('5');
  const [cap, setCap] = useState('');
  const [state, setState] = useState<string>(STATES.find((s) => s === project.state) ?? 'NSW');
  const [scheduleDays, setScheduleDays] = useState('');
  const [paymentDays, setPaymentDays] = useState('');
  const [rows, setRows] = useState<Row[]>([{ code: '', description: '', value: '' }]);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((n, r) => n + (cents(r.value) ?? 0), 0);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const contractValue = cents(value);
    if (!title.trim()) return setError('Give the contract a title.');
    if (contractValue === null)
      return setError('Enter the contract value as a dollar amount, like 250000.00.');
    if (rows.some((r) => !r.code.trim() || !r.description.trim() || cents(r.value) === null))
      return setError('Every schedule of values line needs a code, a description and an amount.');
    if (total !== contractValue)
      return setError(
        `The schedule of values adds up to ${aud((total / 100).toFixed(2))}, not the contract value.`,
      );
    const body: CreateContract = {
      kind,
      title: title.trim(),
      originalValue: value.trim(),
      retentionPct: retention.trim() || '0',
      ...(payee ? { payeeCompanyId: payee } : {}),
      ...(cap.trim() ? { retentionCapPct: cap.trim() } : {}),
      sopaState: state as (typeof STATES)[number],
      ...(scheduleDays ? { scheduleDays: Number(scheduleDays) } : {}),
      ...(paymentDays ? { paymentDays: Number(paymentDays) } : {}),
      sov: rows.map((r) => ({
        code: r.code.trim(),
        description: r.description.trim(),
        value: r.value.trim(),
      })),
    };
    createContract.mutate(body, {
      onSuccess: (d) =>
        router.push(webRoutes.contract(org.orgSlug, project.projectId, d.contract.id)),
    });
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="New contract"
        description="Claims are checked against this schedule of values."
      />
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <Select
            label="Type"
            value={kind}
            options={[
              { value: 'subcontract', label: 'Subcontract (we pay)' },
              { value: 'head', label: 'Head contract (we are paid)' },
            ]}
            onChange={(e) => setKind(e.target.value as 'head' | 'subcontract')}
          />
          <TextField
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Select
            label="Payee"
            value={payee}
            placeholder="Choose a company"
            hint="The company that is paid. A subcontractor sees only contracts where they are the payee."
            options={dir.companies.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => setPayee(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Contract value (ex GST)"
            inputMode="decimal"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <TextField
            label="Retention %"
            inputMode="decimal"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
          <TextField
            label="Retention cap %"
            inputMode="decimal"
            hint="Of the contract value. Blank for no cap."
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </div>
        <div className="form-row">
          <Select
            label="Security of Payment state"
            value={state}
            options={STATES.map((s) => ({ value: s, label: s }))}
            hint="The Act the claims run under. Dates for other states are not available yet."
            onChange={(e) => setState(e.target.value)}
          />
          <TextField
            label="Contract days to give a payment schedule"
            inputMode="numeric"
            hint="Business days. Leave blank if the contract is silent; the Act's period applies."
            value={scheduleDays}
            onChange={(e) => setScheduleDays(e.target.value)}
          />
          <TextField
            label="Contract days to pay"
            inputMode="numeric"
            hint="Leave blank if the contract is silent. A term longer than the Act allows is read down."
            value={paymentDays}
            onChange={(e) => setPaymentDays(e.target.value)}
          />
        </div>
        <fieldset className="stack">
          <legend>Schedule of values</legend>
          {rows.map((r, i) => (
            <div className="form-row" key={i}>
              <TextField
                label={`Code ${i + 1}`}
                value={r.code}
                onChange={(e) => setRow(i, { code: e.target.value })}
              />
              <TextField
                label={`Description ${i + 1}`}
                value={r.description}
                onChange={(e) => setRow(i, { description: e.target.value })}
              />
              <TextField
                label={`Amount ${i + 1} (ex GST)`}
                inputMode="decimal"
                value={r.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
              />
              {rows.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  Remove line {i + 1}
                </Button>
              ) : null}
            </div>
          ))}
          <div className="row-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRows((rs) => [...rs, { code: '', description: '', value: '' }])}
            >
              Add line
            </Button>
            <span className="u-mono" aria-live="polite">
              Total {aud((total / 100).toFixed(2))}
            </span>
          </div>
        </fieldset>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={createContract.error} title="We couldn't save this contract" />
        <div className="row-actions">
          <Button type="submit" disabled={createContract.isPending}>
            {createContract.isPending ? 'Saving…' : 'Save contract'}
          </Button>
          <Link className="link" href={webRoutes.contracts(org.orgSlug, project.projectId)}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
