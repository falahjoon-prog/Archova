'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, DescriptionList, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentClaimDetail } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { aud, cents } from '../lib/money';

/** The shortest reason that counts. Matches the server. */
const MIN_REASON = 10;
type Deduction = { description: string; amount: string; reason: string };

type Line = PaymentClaimDetail['lines'][number];
const keyOf = (l: Line) => (l.sovItemId ?? l.variationId)!;

/**
 * Issues the payment schedule line by line. Each line starts at what the claim took; take it down and that line
 * needs its own reason, because in most states the reasons given here are the only ones that can be relied on in
 * adjudication. Amounts withheld that are not about a line (set-offs, back-charges) go in as deductions, each with
 * its own reason. Retention is recalculated from the contract's terms by the server when the schedule is issued, so
 * no net is guessed here. Nothing is chosen for the person.
 */
export function LineScheduleForm({
  detail,
  describe,
}: {
  detail: PaymentClaimDetail;
  describe: (l: Line) => string;
}) {
  const project = useCurrentProject();
  const { issueSchedule } = useClaimsMutations(project.projectId);
  const lines = detail.lines;
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [keyOf(l), l.thisClaim])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const parsed = lines.map((l) => ({
    line: l,
    claimed: cents(l.thisClaim) ?? 0,
    scheduled: cents(amounts[keyOf(l)] ?? ''),
  }));
  const valid = parsed.every((p) => p.scheduled !== null && p.scheduled <= p.claimed);
  const claimedGross = parsed.reduce((n, p) => n + p.claimed, 0);
  const scheduledGross = parsed.reduce((n, p) => n + (p.scheduled ?? 0), 0);
  const money = (c: number) => aud((c / 100).toFixed(2));

  const setDeduction = (n: number, patch: Partial<Deduction>) =>
    setDeductions(deductions.map((d, i) => (i === n ? { ...d, ...patch } : d)));

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    for (const p of parsed) {
      const name = describe(p.line);
      if (p.scheduled === null)
        return setError(`Enter the amount for ${name} as a dollar amount, like 12500.00.`);
      if (p.scheduled > p.claimed)
        return setError(
          `${name} can't be scheduled for more than the claim took (${money(p.claimed)}).`,
        );
      if (p.scheduled < p.claimed && (reasons[keyOf(p.line)] ?? '').trim().length < MIN_REASON)
        return setError(
          `Give the reason for reducing ${name}, at least ${MIN_REASON} characters. In most states you can’t add new reasons later.`,
        );
    }
    for (const [n, d] of deductions.entries()) {
      const amount = cents(d.amount);
      if (!d.description.trim() || amount === null || amount <= 0)
        return setError(
          `Deduction ${n + 1}: say what it is and enter the amount withheld, like 500.00.`,
        );
      if (d.reason.trim().length < MIN_REASON)
        return setError(
          `Deduction ${n + 1}: give the reason, at least ${MIN_REASON} characters. In most states you can’t add new reasons later.`,
        );
    }
    issueSchedule.mutate({
      claimId: detail.claim.id,
      body: {
        lines: parsed
          .filter((p) => p.scheduled! < p.claimed)
          .map((p) => ({
            ...(p.line.sovItemId ? { sovItemId: p.line.sovItemId } : {}),
            ...(p.line.variationId ? { variationId: p.line.variationId } : {}),
            scheduledAmount: amounts[keyOf(p.line)]!.trim(),
            reason: reasons[keyOf(p.line)]!.trim(),
          })),
        ...(deductions.length
          ? {
              deductions: deductions.map((d) => ({
                description: d.description.trim(),
                amount: d.amount.trim(),
                reason: d.reason.trim(),
              })),
            }
          : {}),
      },
    });
  }

  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      {parsed.map((p) => {
        const k = keyOf(p.line);
        const reduced = p.scheduled !== null && p.scheduled < p.claimed;
        return (
          <div className="stack" key={k}>
            <TextField
              label={`${describe(p.line)}: amount to schedule (ex GST)`}
              inputMode="decimal"
              value={amounts[k] ?? ''}
              hint={`Claimed ${aud(p.line.thisClaim)} on this line.`}
              onChange={(e) => setAmounts({ ...amounts, [k]: e.target.value })}
            />
            {reduced ? (
              <Textarea
                label={`Reason for reducing ${describe(p.line)}`}
                required
                value={reasons[k] ?? ''}
                hint={`${money(p.claimed - p.scheduled!)} withheld on this line. Be specific: name the work or record.`}
                onChange={(e) => setReasons({ ...reasons, [k]: e.target.value })}
              />
            ) : null}
          </div>
        );
      })}
      <div className="stack">
        {deductions.map((d, n) => (
          <div className="stack" key={n}>
            <TextField
              label={`Deduction ${n + 1}: what is being withheld`}
              hint="A set-off, back-charge or liquidated damages that isn't about one line."
              value={d.description}
              onChange={(e) => setDeduction(n, { description: e.target.value })}
            />
            <TextField
              label={`Deduction ${n + 1}: amount withheld (ex GST)`}
              inputMode="decimal"
              value={d.amount}
              onChange={(e) => setDeduction(n, { amount: e.target.value })}
            />
            <Textarea
              label={`Deduction ${n + 1}: reason`}
              required
              value={d.reason}
              onChange={(e) => setDeduction(n, { reason: e.target.value })}
            />
            <div className="row-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeductions(deductions.filter((_, i) => i !== n))}
              >
                {`Remove deduction ${n + 1}`}
              </Button>
            </div>
          </div>
        ))}
        <div className="row-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setDeductions([...deductions, { description: '', amount: '', reason: '' }])
            }
          >
            Add a set-off or back-charge
          </Button>
        </div>
      </div>
      <DescriptionList
        items={[
          {
            label: 'Lines scheduled (ex GST, before retention)',
            value: valid ? money(scheduledGross) : '—',
            mono: true,
          },
          {
            label: 'Withheld on lines',
            value: valid ? money(claimedGross - scheduledGross) : '—',
            mono: true,
          },
        ]}
      />
      <Alert tone="info" title="Retention is recalculated">
        Retention is worked out again from the contract's terms on the amount scheduled when you
        issue, and rounded to the cent. The schedule is shown to you with the final figures once
        issued.
      </Alert>
      <Alert tone="warning" title="This can't be undone">
        Once issued, the payment schedule and the reasons on each line are locked as a record of
        what you gave and when.
      </Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ErrorAlert error={issueSchedule.error} title="We couldn't issue this schedule" />
      <div className="row-actions">
        <Button type="submit" disabled={issueSchedule.isPending}>
          {issueSchedule.isPending ? 'Issuing…' : 'Issue payment schedule'}
        </Button>
      </div>
    </form>
  );
}
