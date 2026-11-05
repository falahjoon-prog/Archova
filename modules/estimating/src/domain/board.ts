// Bid board rules: where each tender package stands against its due date, and how invitees have answered. Pure.
import { lowestQuote, type PackageStatus } from './tender';

export type DueState = 'overdue' | 'closing_soon' | 'open';

/** A package out to tender is "closing soon" inside this many hours of its due time. */
export const CLOSING_SOON_HOURS = 72;

/**
 * Only a package still taking quotes has a due state. Past its due time and still out to tender is overdue; the
 * estimator closes or extends it.
 */
export function dueState(status: PackageStatus, dueAt: Date | null, now: Date): DueState | null {
  if (status !== 'out_to_tender' || !dueAt) return null;
  const ms = dueAt.getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  return ms <= CLOSING_SOON_HOURS * 3_600_000 ? 'closing_soon' : 'open';
}

export interface InviteTally {
  invited: number;
  viewed: number;
  declined: number;
  intendsToQuote: number;
  submitted: number;
  /** Invitees who have not yet said yes or no: invited or only viewed. */
  awaiting: number;
}

export function tallyInvites(statuses: readonly string[]): InviteTally {
  const count = (s: string) => statuses.filter((x) => x === s).length;
  const invited = count('invited');
  const viewed = count('viewed');
  return {
    invited,
    viewed,
    declined: count('declined'),
    intendsToQuote: count('intends_to_quote'),
    submitted: count('submitted'),
    awaiting: invited + viewed,
  };
}

/** The levelled (allowances included) ex-GST total of the lowest confirmed quote, or null with none in the running. */
export function lowestLevelledCents(
  quotes: ReadonlyArray<{ id: string; status: string; totalExGst: string }>,
  allowances: Readonly<Record<string, string>>,
  toCents: (v: string) => number,
): number | null {
  const id = lowestQuote(quotes, allowances);
  if (!id) return null;
  const q = quotes.find((x) => x.id === id)!;
  const extra = Object.entries(allowances)
    .filter(([k]) => k.startsWith(`${id}:`))
    .reduce((sum, [, v]) => sum + toCents(v), 0);
  return toCents(q.totalExGst) + extra;
}
