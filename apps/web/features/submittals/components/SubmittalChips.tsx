import { StatusPill } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import { STATUS_LABELS, STATUS_TONES, type Submittal } from '../lib/types';

export function SubmittalStatusPill({ status }: { status: Submittal['status'] }) {
  return <StatusPill tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</StatusPill>;
}

/** SUB-AC2: the submit-by date, amber once it has passed with nothing submitted, red five business days later. */
export function SubmitBy({ item }: { item: Pick<Submittal, 'submitBy' | 'submitByState'> }) {
  if (!item.submitBy) return <span className="u-muted">Set a required-on-site date</span>;
  const date = formatLocalDate(item.submitBy);
  if (item.submitByState === 'red') return <StatusPill tone="danger">Late · {date}</StatusPill>;
  if (item.submitByState === 'amber')
    return <StatusPill tone="warning">Due now · {date}</StatusPill>;
  return <span>{date}</span>;
}

export function ballLabel(
  item: Pick<Submittal, 'ballInCourt' | 'responsibleCompanyId'>,
  dir: { personName(id: string | null): string; companyName(id: string | null): string },
  meId: string,
): string | null {
  const { side, userIds } = item.ballInCourt;
  if (!side) return null;
  if (side === 'subcontractor')
    return `Waiting on: ${item.responsibleCompanyId ? dir.companyName(item.responsibleCompanyId) : 'Subcontractor'}`;
  const who = userIds[0];
  return `Waiting on: ${who === meId ? 'you' : dir.personName(who ?? null)}`;
}
