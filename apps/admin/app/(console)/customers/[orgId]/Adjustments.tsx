'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Select, StatusPill, TextField } from '@archova/ui';
import {
  OVERRIDE_LIMIT_KEYS,
  PLAN_MODULE_KEYS,
  type OrgDetailDto,
  type OrgDiscountDto,
  type OrgOverrideDto,
} from '@archova/contracts';
import { api } from '@/shared/api';
import { OrgActionDialog } from '@/shared/OrgActionDialog';
import { useStepUp } from '@/shared/StepUp';
import { can, useStaff } from '@/shared/staff';
import { STATUS_LABEL, formatDate, formatMoney, statusTone } from '@/shared/format';

type Dialogue = 'discount' | 'override' | 'refund' | null;
type Revoke =
  { kind: 'discount'; item: OrgDiscountDto } | { kind: 'override'; item: OrgOverrideDto };

const KIND_OPTIONS = [
  { value: 'module', label: 'Add a module' },
  { value: 'limit', label: 'Replace a limit' },
];
const MODULE_OPTIONS = PLAN_MODULE_KEYS.map((k) => ({ value: k, label: k }));
const LIMIT_OPTIONS = OVERRIDE_LIMIT_KEYS.map((k) => ({ value: k, label: k }));

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
/** Dollars as typed ("1250.50") to whole cents; NaN when it is not a money amount. */
const toCents = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : NaN;

const PILL = {
  active: 'success',
  live: 'success',
  ended: 'neutral',
  expired: 'neutral',
  revoked: 'warning',
} as const;

/**
 * Discounts, entitlement overrides and refunds for one customer (backend 09 §6). The limits are enforced on the
 * server; the dialogs only say what they are. A refund over A$5,000 becomes a request in Approvals.
 */
export function Adjustments({ org }: { org: OrgDetailDto }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const [open, setOpen] = useState<Dialogue>(null);
  const [revoke, setRevoke] = useState<Revoke | null>(null);
  const [percent, setPercent] = useState('10');
  const [months, setMonths] = useState('3');
  const [okind, setOkind] = useState<'module' | 'limit'>('module');
  const [moduleKey, setModuleKey] = useState<string>(PLAN_MODULE_KEYS[0]);
  const [limitKey, setLimitKey] = useState<string>(OVERRIDE_LIMIT_KEYS[0]);
  const [limitValue, setLimitValue] = useState('0');
  const [days, setDays] = useState('30');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState('');

  const canDiscount = can(staff, 'backoffice.accounts.discount');
  const canOverride = can(staff, 'backoffice.accounts.override');
  const canRefund = can(staff, 'backoffice.accounts.refund');
  if (!canDiscount && !canOverride && !canRefund) return null;

  const done = (fresh: OrgDetailDto) => {
    qc.setQueryData(['org', org.orgId], fresh);
    void qc.invalidateQueries({ queryKey: ['requests'] });
  };
  const close = () => setOpen(null);

  const p = whole(percent);
  const m = whole(months);
  const d = whole(days);
  const lv = whole(limitValue);
  const cents = toCents(amount);
  const paidCents = toCents(paid);
  const pOk = Number.isInteger(p) && p >= 1 && p <= 100;
  const mOk = Number.isInteger(m) && m >= 1 && m <= 12;
  const dOk = Number.isInteger(d) && d >= 1 && d <= 365;
  const lvOk = okind === 'module' || Number.isInteger(lv);
  const refundOk =
    invoiceRef.trim().length > 0 &&
    Number.isInteger(cents) &&
    cents > 0 &&
    Number.isInteger(paidCents) &&
    paidCents >= cents;
  const hasActiveDiscount = org.discounts.some((x) => x.status === 'active');

  return (
    <Card title="Discounts, overrides and refunds">
      <div className="row">
        {canDiscount ? (
          <Button
            variant="secondary"
            onClick={() => setOpen('discount')}
            disabled={hasActiveDiscount}
          >
            Add discount
          </Button>
        ) : null}
        {canOverride ? (
          <Button variant="secondary" onClick={() => setOpen('override')}>
            Add override
          </Button>
        ) : null}
        {canRefund ? (
          <Button variant="secondary" onClick={() => setOpen('refund')}>
            Record refund
          </Button>
        ) : null}
      </div>

      {org.discounts.length ? (
        <>
          <h3>Discounts</h3>
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {org.discounts.map((x) => (
              <li key={x.id} className="row">
                <StatusPill tone={PILL[x.status]}>{x.status}</StatusPill>
                <span>
                  {x.percent}% off, {formatDate(x.startsOn)} to {formatDate(x.endsOn)}{' '}
                  <span className="muted">
                    · {x.ticketRef} · {x.reason}
                  </span>
                </span>
                {x.status === 'active' && canDiscount ? (
                  <Button
                    variant="tertiary"
                    onClick={() => setRevoke({ kind: 'discount', item: x })}
                  >
                    End early
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {org.overrides.length ? (
        <>
          <h3>Overrides</h3>
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {org.overrides.map((x) => (
              <li key={x.id} className="row">
                <StatusPill tone={PILL[x.status]}>{x.status}</StatusPill>
                <span>
                  {x.kind === 'module' ? `Adds ${x.key}` : `${x.key} set to ${x.limitValue}`}, until{' '}
                  {formatDate(x.expiresAt)}{' '}
                  <span className="muted">
                    · {x.ticketRef} · {x.reason}
                  </span>
                </span>
                {x.status === 'live' && canOverride ? (
                  <Button
                    variant="tertiary"
                    onClick={() => setRevoke({ kind: 'override', item: x })}
                  >
                    End early
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {org.refunds.length ? (
        <>
          <h3>Refunds</h3>
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {org.refunds.map((x) => (
              <li key={x.id} className="row">
                <StatusPill tone={statusTone(x.status)}>
                  {STATUS_LABEL[x.status] ?? x.status}
                </StatusPill>
                <span>
                  {formatMoney(x.amountCents)} on invoice{' '}
                  <span className="mono">{x.invoiceRef}</span>{' '}
                  <span className="muted">
                    · collected {formatMoney(x.paidCents)} · {x.ticketRef} · {x.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <OrgActionDialog
        open={open === 'discount'}
        title="Add a discount"
        description="A percentage off this company's price for 1 to 12 months. One discount at a time. Support and Sales can give up to 20%; more needs an Owner."
        confirmLabel="Add discount"
        fields={
          <>
            <TextField
              label="Percent off"
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              error={pOk ? undefined : 'A whole number from 1 to 100'}
            />
            <TextField
              label="Months"
              inputMode="numeric"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              error={mOk ? undefined : 'A whole number from 1 to 12'}
            />
          </>
        }
        onClose={close}
        onConfirm={async (i) => {
          if (!pOk || !mOk) throw new Error('Check the percent and the months.');
          done(await withStepUp(() => api.addDiscount(org.orgId, { percent: p, months: m, ...i })));
        }}
      />
      <OrgActionDialog
        open={open === 'override'}
        title="Add an override"
        description="Gives this company a module, or replaces a limit, for a set time. Up to 90 days; longer, or a module from a higher plan, needs an Owner."
        confirmLabel="Add override"
        fields={
          <>
            <Select
              label="What"
              value={okind}
              onChange={(e) => setOkind(e.target.value as 'module' | 'limit')}
              options={KIND_OPTIONS}
            />
            {okind === 'module' ? (
              <Select
                label="Module"
                value={moduleKey}
                onChange={(e) => setModuleKey(e.target.value)}
                options={MODULE_OPTIONS}
              />
            ) : (
              <>
                <Select
                  label="Limit"
                  value={limitKey}
                  onChange={(e) => setLimitKey(e.target.value)}
                  options={LIMIT_OPTIONS}
                />
                <TextField
                  label="New value"
                  inputMode="numeric"
                  value={limitValue}
                  onChange={(e) => setLimitValue(e.target.value)}
                  error={lvOk ? undefined : 'A whole number, 0 or more'}
                />
              </>
            )}
            <TextField
              label="Days"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              error={dOk ? undefined : 'A whole number from 1 to 365'}
            />
          </>
        }
        onClose={close}
        onConfirm={async (i) => {
          if (!dOk || !lvOk) throw new Error('Check the days and the value.');
          done(
            await withStepUp(() =>
              api.grantOverride(org.orgId, {
                kind: okind,
                key: okind === 'module' ? moduleKey : limitKey,
                limitValue: okind === 'limit' ? lv : null,
                days: d,
                ...i,
              }),
            ),
          );
        }}
      />
      <OrgActionDialog
        open={open === 'refund'}
        title="Record a refund"
        description="Records that money is owed back; it does not pay anyone. It cannot be more than the invoice collected. Over A$5,000 a second person has to approve it in Approvals."
        confirmLabel="Record refund"
        fields={
          <>
            <TextField
              label="Invoice reference"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
            />
            <TextField
              label="Refund amount (A$)"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={amount === '' || Number.isInteger(cents) ? undefined : 'Dollars, like 250.00'}
            />
            <TextField
              label="Invoice collected (A$)"
              inputMode="decimal"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              error={
                paid === '' || (Number.isInteger(paidCents) && !(paidCents < cents))
                  ? undefined
                  : 'Dollars, and not less than the refund'
              }
            />
          </>
        }
        onClose={close}
        onConfirm={async (i) => {
          if (!refundOk) throw new Error('Enter the invoice, the refund and what it collected.');
          done(
            await withStepUp(() =>
              api.refund(org.orgId, {
                invoiceRef: invoiceRef.trim(),
                amountCents: cents,
                paidCents,
                ...i,
              }),
            ),
          );
          setInvoiceRef('');
          setAmount('');
          setPaid('');
        }}
      />
      <OrgActionDialog
        open={revoke !== null}
        title={revoke?.kind === 'discount' ? 'End the discount early' : 'End the override early'}
        description="The company goes back to its plan price or entitlements straight away."
        confirmLabel="End early"
        onClose={() => setRevoke(null)}
        onConfirm={async (i) => {
          if (!revoke) return;
          done(
            await withStepUp(() =>
              revoke.kind === 'discount'
                ? api.revokeDiscount(org.orgId, revoke.item.id, i)
                : api.revokeOverride(org.orgId, revoke.item.id, i),
            ),
          );
        }}
      />
    </Card>
  );
}
