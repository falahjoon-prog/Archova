import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type BidBoardEntry = S['BidBoardEntry'];
export type PackageStatus = S['PackageStatus'];

export const STATUS_LABELS: Record<PackageStatus, string> = {
  draft: 'Draft',
  out_to_tender: 'Out to tender',
  closed: 'Closed',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
};

export const STATUS_ORDER: readonly PackageStatus[] = [
  'draft',
  'out_to_tender',
  'closed',
  'awarded',
  'cancelled',
];

/** "3 quoted, 1 declined, 2 awaiting" for the invitees' answers; "No invitees" when nobody was invited. */
export function responseSummary(i: BidBoardEntry['invites']): string {
  const total = i.invited + i.viewed + i.declined + i.intendsToQuote + i.submitted;
  if (total === 0) return 'No invitees';
  const parts = [
    i.submitted ? `${i.submitted} quoted` : '',
    i.intendsToQuote ? `${i.intendsToQuote} intend to quote` : '',
    i.declined ? `${i.declined} declined` : '',
    i.awaiting ? `${i.awaiting} awaiting` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

export interface BoardSummary {
  overdue: number;
  closingSoon: number;
  outToTender: number;
  toReview: number;
  awarded: number;
}

export function summarise(rows: readonly BidBoardEntry[]): BoardSummary {
  return {
    overdue: rows.filter((r) => r.dueState === 'overdue').length,
    closingSoon: rows.filter((r) => r.dueState === 'closing_soon').length,
    outToTender: rows.filter((r) => r.status === 'out_to_tender').length,
    toReview: rows.reduce((n, r) => n + r.quotesToReview, 0),
    awarded: rows.filter((r) => r.awarded).length,
  };
}
