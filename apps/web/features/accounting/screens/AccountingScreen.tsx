'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Switch,
  TextField,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  PROVIDER_NAME,
  type Connection,
  type FieldMap,
  type Provider,
  type Settings,
} from '../data/api';
import {
  useConnections,
  useDisconnect,
  useResolveIssue,
  useSaveFieldMap,
  useSaveSettings,
  useSelectTarget,
  useStartConnection,
  useSyncIssues,
  useTargets,
} from '../hooks/useAccounting';
import { RETURN_KEY, type ReturnTo } from './AccountingCallbackScreen';

const STATUS: Record<Connection['status'], { tone: StatusTone; label: string }> = {
  pending: { tone: 'neutral', label: 'Sign-in not finished' },
  needs_target: { tone: 'warning', label: 'Choose a company' },
  active: { tone: 'success', label: 'Connected' },
  error: { tone: 'danger', label: 'Needs reconnecting' },
};

const BILL_STATUS = [
  { value: 'draft', label: 'Draft, for your bookkeeper to approve' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
];

const KIND_LABEL = {
  unmapped_cost_code: 'Unmapped cost code',
  remote_locked: 'Already approved in the accounting system',
  rejected: 'Refused by the accounting system',
  no_contact: 'No matching supplier or customer',
  auth_failed: 'Access refused',
} as const;

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Sends the browser to the provider; the org is remembered so the callback page knows where to return. */
function useConnect() {
  const org = useCurrentOrg();
  const start = useStartConnection();
  return {
    pending: start.isPending,
    error: start.error,
    connect: (provider: Provider) =>
      start.mutate(provider, {
        onSuccess: (url) => {
          const back: ReturnTo = { orgId: org.orgId, orgSlug: org.orgSlug };
          try {
            window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(back));
          } catch {
            // Without storage the callback page asks the admin to start again.
          }
          window.location.assign(url);
        },
      }),
  };
}

function TargetPicker({ provider }: { provider: Provider }) {
  const targets = useTargets(provider, true);
  const select = useSelectTarget(provider);
  const [ref, setRef] = useState('');
  if (targets.isPending) return <SkeletonRows rows={2} />;
  if (targets.error) return <ErrorAlert error={targets.error} />;
  const options = targets.data.map((t) => ({ value: t.ref, label: t.name }));
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const t = targets.data.find((x) => x.ref === ref);
        if (t) select.mutate(t);
      }}
    >
      <Select
        label={provider === 'xero' ? 'Xero organisation' : 'MYOB company file'}
        options={options}
        placeholder="Choose one"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      {select.error ? <ErrorAlert error={select.error} /> : null}
      <div>
        <Button type="submit" disabled={!ref} loading={select.isPending}>
          Use this one
        </Button>
      </div>
    </form>
  );
}

interface MapRow {
  key: number;
  costCode: string;
  accountRef: string;
  taxRef: string;
  trackingRef: string;
}

function rowsOf(map: FieldMap): MapRow[] {
  return Object.entries(map.accounts).map(([costCode, t], key) => ({
    key,
    costCode,
    accountRef: t.accountRef,
    taxRef: t.taxRef,
    trackingRef: t.trackingRef ?? '',
  }));
}

function FieldMapEditor({ connection }: { connection: Connection }) {
  const save = useSaveFieldMap(connection.provider);
  const [rows, setRows] = useState<MapRow[]>(() => rowsOf(connection.fieldMap));
  const [retAccount, setRetAccount] = useState(connection.fieldMap.retention?.accountRef ?? '');
  const [retTax, setRetTax] = useState(connection.fieldMap.retention?.taxRef ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const next = () => Math.max(-1, ...rows.map((r) => r.key)) + 1;
  const edit = (key: number, patch: Partial<MapRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const codes = rows.map((r) => r.costCode.trim());
    if (rows.some((r) => !r.costCode.trim() || !r.accountRef.trim() || !r.taxRef.trim()))
      return setProblem('Every row needs a cost code, an account and a tax code.');
    if (new Set(codes).size !== codes.length)
      return setProblem('Each cost code can be mapped once.');
    if (!retAccount.trim() || !retTax.trim())
      return setProblem('Choose the retention account and its tax code.');
    setProblem(null);
    save.mutate({
      accounts: Object.fromEntries(
        rows.map((r) => [
          r.costCode.trim(),
          {
            accountRef: r.accountRef.trim(),
            taxRef: r.taxRef.trim(),
            ...(r.trackingRef.trim() ? { trackingRef: r.trackingRef.trim() } : {}),
          },
        ]),
      ),
      retention: { accountRef: retAccount.trim(), taxRef: retTax.trim() },
    });
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <p className="u-caption u-m-0">
        Which {PROVIDER_NAME[connection.provider]} account each cost code posts to. A cost code with
        no row blocks the push and shows up under sync issues.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No cost codes mapped yet" />
      ) : (
        <ul className="accounting__list">
          {rows.map((r) => (
            <li key={r.key} className="accounting__row">
              <TextField
                label="Cost code"
                value={r.costCode}
                onChange={(e) => edit(r.key, { costCode: e.target.value })}
              />
              <TextField
                label="Account"
                value={r.accountRef}
                onChange={(e) => edit(r.key, { accountRef: e.target.value })}
              />
              <TextField
                label="Tax code"
                value={r.taxRef}
                onChange={(e) => edit(r.key, { taxRef: e.target.value })}
              />
              <TextField
                label="Tracking (optional)"
                value={r.trackingRef}
                onChange={(e) => edit(r.key, { trackingRef: e.target.value })}
              />
              <Button
                variant="tertiary"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                aria-label={`Remove ${r.costCode || 'row'}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { key: next(), costCode: '', accountRef: '', taxRef: '', trackingRef: '' },
            ])
          }
        >
          Add a cost code
        </Button>
      </div>
      <div className="accounting__retention">
        <TextField
          label="Retention account"
          value={retAccount}
          onChange={(e) => setRetAccount(e.target.value)}
        />
        <TextField
          label="Retention tax code"
          value={retTax}
          onChange={(e) => setRetTax(e.target.value)}
        />
      </div>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {save.error ? <ErrorAlert error={save.error} /> : null}
      {save.isSuccess ? (
        <p role="status" className="u-caption u-m-0">
          Saved.
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={save.isPending}>
          Save the map
        </Button>
      </div>
    </form>
  );
}

function SettingsEditor({ connection }: { connection: Connection }) {
  const save = useSaveSettings(connection.provider);
  const [s, setS] = useState<Settings>(connection.settings);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(s);
      }}
    >
      <Switch
        label="Send subcontractor payment schedules as bills"
        checked={s.pushBills}
        onCheckedChange={(pushBills) => setS({ ...s, pushBills })}
      />
      <Switch
        label="Send claims to the client as invoices"
        checked={s.pushInvoices}
        onCheckedChange={(pushInvoices) => setS({ ...s, pushInvoices })}
      />
      {connection.provider === 'xero' ? (
        <Select
          label="New bills are created as"
          options={BILL_STATUS}
          value={s.billStatus}
          onChange={(e) => setS({ ...s, billStatus: e.target.value as Settings['billStatus'] })}
        />
      ) : (
        <p className="u-caption u-m-0">
          MYOB has no draft bills, so documents arrive open. They are never changed after that.
        </p>
      )}
      <TextField
        label="Start date"
        type="date"
        hint="Nothing dated before this is sent."
        value={s.startDate ?? ''}
        onChange={(e) => setS({ ...s, startDate: e.target.value || null })}
      />
      {save.error ? <ErrorAlert error={save.error} /> : null}
      {save.isSuccess ? (
        <p role="status" className="u-caption u-m-0">
          Saved.
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

function ProviderCard({
  provider,
  connection,
}: {
  provider: Provider;
  connection: Connection | null;
}) {
  const { connect, pending, error } = useConnect();
  const disconnect = useDisconnect(provider);
  const [confirming, setConfirming] = useState(false);
  const name = PROVIDER_NAME[provider];
  const status = connection ? STATUS[connection.status] : null;
  const active = connection?.status === 'active';
  const [tab, setTab] = useState<'map' | 'settings'>('map');
  useEffect(() => setConfirming(false), [connection?.status]);

  return (
    <Card
      title={name}
      actions={status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
    >
      <div className="stack">
        {!connection ? (
          <>
            <p className="u-m-0">
              Send approved subcontractor schedules and claims to {name}, and see when they are
              paid.
            </p>
            <div>
              <Button onClick={() => connect(provider)} loading={pending}>
                Connect {name}
              </Button>
            </div>
          </>
        ) : null}
        {connection?.status === 'pending' || connection?.status === 'error' ? (
          <>
            {connection.lastError ? <Alert tone="danger">{connection.lastError}</Alert> : null}
            <div>
              <Button onClick={() => connect(provider)} loading={pending}>
                {connection.status === 'error' ? `Reconnect ${name}` : `Connect ${name}`}
              </Button>
            </div>
          </>
        ) : null}
        {connection?.status === 'needs_target' ? <TargetPicker provider={provider} /> : null}
        {active ? (
          <>
            <p className="u-m-0">
              Connected to <strong>{connection.targetName}</strong>
              {connection.lastPulledAt ? (
                <span className="u-caption">
                  {' '}
                  · payments last read {formatInstant(connection.lastPulledAt, tz())}
                </span>
              ) : null}
            </p>
            <div className="accounting__tabs" role="group" aria-label="Section">
              <Button
                variant={tab === 'map' ? 'primary' : 'secondary'}
                onClick={() => setTab('map')}
              >
                Accounts
              </Button>
              <Button
                variant={tab === 'settings' ? 'primary' : 'secondary'}
                onClick={() => setTab('settings')}
              >
                What is sent
              </Button>
            </div>
            {tab === 'map' ? (
              <FieldMapEditor connection={connection} />
            ) : (
              <SettingsEditor connection={connection} />
            )}
          </>
        ) : null}
        {error ? <ErrorAlert error={error} /> : null}
        {disconnect.error ? <ErrorAlert error={disconnect.error} /> : null}
        {connection ? (
          <div className="accounting__danger">
            {confirming ? (
              <>
                <p className="u-caption u-m-0">
                  Archova stops sending to {name}. Bills and invoices already there stay as they
                  are.
                </p>
                <Button
                  variant="danger"
                  loading={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  Yes, disconnect {name}
                </Button>
                <Button variant="tertiary" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="tertiary" onClick={() => setConfirming(true)}>
                Disconnect {name}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function SyncIssues() {
  const issues = useSyncIssues();
  const resolve = useResolveIssue();
  if (issues.isPending) return <SkeletonRows rows={2} />;
  if (issues.error) return <ErrorAlert error={issues.error} />;
  return (
    <Card title="Sync issues">
      {issues.data.length === 0 ? (
        <EmptyState title="Nothing needs attention" />
      ) : (
        <ul className="accounting__list">
          {issues.data.map((i) => (
            <li key={i.id} className="accounting__issue">
              <span>
                <strong>{KIND_LABEL[i.kind]}</strong> · {PROVIDER_NAME[i.provider]}
                {i.reference ? ` · ${i.reference}` : ''}
              </span>
              <span className="u-caption">{i.message}</span>
              <div>
                <Button
                  variant="secondary"
                  loading={resolve.isPending && resolve.variables === i.id}
                  onClick={() => resolve.mutate(i.id)}
                >
                  Mark as dealt with
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {resolve.error ? <ErrorAlert error={resolve.error} /> : null}
    </Card>
  );
}

/** Settings → Accounting (integrations/02 §7): connect Xero or MYOB, map cost codes to accounts, choose what is sent. */
export function AccountingScreen() {
  const connections = useConnections();
  if (connections.isPending) return <SkeletonRows rows={4} />;
  if (connections.error) return <ErrorAlert error={connections.error} />;
  const { data, available } = connections.data;
  const providers = (['xero', 'myob'] as const).filter(
    (p) => available.includes(p) || data.some((c) => c.provider === p),
  );
  return (
    <div className="stack accounting">
      <PageHeader title="Accounting" />
      {providers.length === 0 ? (
        <Alert tone="info" title="Xero and MYOB are not set up yet">
          Archova support needs to add the connection details for these before you can sign in.
        </Alert>
      ) : (
        providers.map((p) => (
          <ProviderCard
            key={p}
            provider={p}
            connection={data.find((c) => c.provider === p) ?? null}
          />
        ))
      )}
      {data.length > 0 ? <SyncIssues /> : null}
    </div>
  );
}
