import { StatusPill } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import type { PaymentClaim } from '../data/api';
import { deadlineState } from '../lib/deadline';

/** Countdown for a claim's payment schedule deadline (CLM-US6, CLM-AC3). Always icon plus words, never colour alone. */
export function DeadlineChip({ claim, today }: { claim: PaymentClaim; today: string }) {
  const { state, businessDays } = deadlineState(claim, today);
  if (state === 'none') return <span className="u-muted">—</span>;
  if (state === 'done') return <StatusPill tone="success">Schedule issued</StatusPill>;
  if (state === 'passed')
    return (
      <StatusPill tone="danger">Deadline passed {formatLocalDate(claim.scheduleDueOn!)}</StatusPill>
    );
  const tone = state === 'danger' ? 'danger' : state === 'warning' ? 'warning' : 'neutral';
  const when =
    businessDays === 0
      ? 'due today'
      : `${businessDays} business day${businessDays === 1 ? '' : 's'} left`;
  return <StatusPill tone={tone}>{when}</StatusPill>;
}
