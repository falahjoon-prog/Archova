import type { Commitment } from '../data/api';

export interface CommitmentRollup {
  /** Approved commitments: the money the project is committed to. */
  committed: number;
  /** Submitted and waiting for a decision. */
  pending: number;
  /** Drafts not yet submitted. */
  draft: number;
  /** Committed plus pending: what the commitments come to if everything waiting is approved. */
  ifApproved: number;
  counts: { approved: number; submitted: number; draft: number };
}

const cents = (amount: string) => Math.round(Number(amount) * 100);

/** Totals in cents across a project's commitments. Rejected and void ones count for nothing. */
export function rollupCommitments(rows: readonly Commitment[]): CommitmentRollup {
  const r: CommitmentRollup = {
    committed: 0,
    pending: 0,
    draft: 0,
    ifApproved: 0,
    counts: { approved: 0, submitted: 0, draft: 0 },
  };
  for (const c of rows) {
    if (c.status === 'approved') {
      r.committed += cents(c.total);
      r.counts.approved++;
    } else if (c.status === 'submitted') {
      r.pending += cents(c.total);
      r.counts.submitted++;
    } else if (c.status === 'draft') {
      r.draft += cents(c.total);
      r.counts.draft++;
    }
  }
  r.ifApproved = r.committed + r.pending;
  return r;
}
