export const STATUS_TEXT: Record<string, string> = {
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
};
export const statusLabel = (s: string) => STATUS_TEXT[s] ?? s;

export const ACTION_TEXT = {
  markReviewed: 'Mark reviewed',
  accept: 'Accept',
  reject: 'Reject',
  reopen: 'Reopen',
} as const;

export const LEVEL_TEXT: Record<string, string> = {
  eliminate: 'Eliminate',
  substitute: 'Substitute',
  isolate: 'Isolate',
  engineer: 'Engineering control',
  administrative: 'Administrative control',
  ppe: 'PPE',
};

/** "fall_2m" becomes "Fall 2m"; the full wording is on the web. */
export const categoryLabel = (c: string) =>
  c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

/** "SWMS-0042, Accepted, revision 2, expired" */
export function swmsSubtitle(s: {
  numberLabel: string;
  status: string;
  revision: number;
  isExpired: boolean;
  expiresOn: string | null;
}): string {
  return [
    s.numberLabel,
    statusLabel(s.status),
    `revision ${s.revision}`,
    s.isExpired ? 'expired' : s.expiresOn ? `expires ${s.expiresOn}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Reject and reopen need a reason; accept needs the reviewer to confirm it is understandable. */
export const needsReason = (a: string) => a === 'reject' || a === 'reopen';
