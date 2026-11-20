'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, DescriptionList, TextField, Textarea } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { PaymentClaimDetail } from '../data/api';
import { useClaimsMutations } from '../hooks/useClaims';
import { aud, cents } from '../lib/money';

type Line = PaymentClaimDetail['lines'][number];
const keyOf = (l: Line) => (l.sovItemId ?? l.variationId)!;

/**
 * Issues the payment schedule line by line. Each line starts at what the claim took; take it down and that line
 * needs its own reason, because the reasons given here are the only ones that can be relied on in adjudication. The
 * total, with retention in proportion, is worked out the way the server does it. Nothing is chosen for the person.
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
  const [error, setError] = useState<string | null>(null);

  const claimedGross = lines.reduce((n, l) => n + (cents(l.thisClaim) ?? 0), 0);
  const net = cents(detail.claim.claimedNet) ?? 0;
  const parsed = lines.map((l) => ({
    line: l,
    claimed: cents(l.thisClaim) ?? 0,
    scheduled: cents(amounts[keyOf(l)] ?? ''),
  }));
  const valid = parsed.every((p) => p.scheduled !== null && p.scheduled <= p.claimed);
  const scheduledGross = parsed.reduce((n, p) => n + (p.scheduled ?? 0), 0);
  const scheduledNet =
    scheduledGross === claimedGross || claimedGross === 0
      ? net
      : Math.round((net * scheduledGross) / claimedGross);
  const money = (c: number) => aud((c / 100).toFixed(2));

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
      if (p.scheduled < p.claimed && !(reasons[keyOf(p.line)] ?? '').trim())
        return setError(
          `Give the reason for reducing ${name}. The Act requires it, and you can’t add new ones later.`,
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
      <DescriptionList
        items={[
          {
            label: 'Scheduled (ex GST, after retention)',
            value: valid ? money(scheduledNet) : '—',
            mono: true,
          },
          {
            label: 'Withheld',
            value: valid ? money(net - scheduledNet) : '—',
            mono: true,
          },
        ]}
      />
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
