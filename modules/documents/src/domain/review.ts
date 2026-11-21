// Review matrix rules (pure). Steps with the same order run together; a later order waits until every earlier
// step has been decided. Any rejection ends the round at once; otherwise the round is approved when every step
// is decided. No I/O here, so the rules are unit tested directly.
import type { ReviewMode, StepRole, StepStatus } from '../infra/tables';

export interface StepState {
  id: string;
  userId: string;
  role: StepRole;
  order: number;
  status: StepStatus;
}

export type ReviewOutcome = 'open' | 'approved' | 'rejected';

const DONE: readonly StepStatus[] = ['approved', 'approved_with_comments', 'skipped'];

/** Which steps start as `pending`: everyone in a parallel round, the first order group in a sequential one. */
export function initialStatuses(
  mode: ReviewMode,
  steps: readonly { order: number }[],
): StepStatus[] {
  if (mode === 'parallel') return steps.map(() => 'pending');
  const first = Math.min(...steps.map((s) => s.order));
  return steps.map((s) => (s.order === first ? 'pending' : 'waiting'));
}

/**
 * The state after one step was decided. A rejection skips everything still open. Otherwise, in a sequential round,
 * the next order group becomes pending once the current one is fully decided.
 */
export function settle(
  mode: ReviewMode,
  steps: readonly StepState[],
): { statuses: Map<string, StepStatus>; outcome: ReviewOutcome } {
  const statuses = new Map(steps.map((s) => [s.id, s.status] as const));
  if (steps.some((s) => s.status === 'rejected')) {
    for (const s of steps)
      if (s.status === 'pending' || s.status === 'waiting') statuses.set(s.id, 'skipped');
    return { statuses, outcome: 'rejected' };
  }
  if (steps.every((s) => DONE.includes(s.status))) return { statuses, outcome: 'approved' };
  if (mode === 'sequential') {
    const open = steps.filter((s) => !DONE.includes(s.status));
    const stillPending = open.some((s) => s.status === 'pending');
    if (!stillPending) {
      const next = Math.min(...open.map((s) => s.order));
      for (const s of open) if (s.order === next) statuses.set(s.id, 'pending');
    }
  }
  return { statuses, outcome: 'open' };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A review with no due date is "stuck" once a step has been waiting on the same person this long. */
export const DEFAULT_REVIEW_SLA_DAYS = 5;

export interface StuckInput {
  dueAt: Date | null;
  /** When the oldest pending step was handed to its person. */
  waitingSince: Date | null;
  now: Date;
}

/** Whether a review is past its SLA, and by how many whole days (0 when it is not). */
export function overdueDays(i: StuckInput): number {
  const limit =
    i.dueAt ??
    (i.waitingSince ? new Date(i.waitingSince.getTime() + DEFAULT_REVIEW_SLA_DAYS * DAY_MS) : null);
  if (!limit || limit.getTime() >= i.now.getTime()) return 0;
  return Math.max(1, Math.floor((i.now.getTime() - limit.getTime()) / DAY_MS));
}

/**
 * Suggested reviewers for a document: people who decided past review steps on the same document type, most
 * frequent first (rules only, no model). `history` has one entry per past decided step.
 */
export function suggestReviewers(
  history: readonly { userId: string; role: StepRole }[],
  limit = 5,
): { userId: string; role: StepRole; count: number }[] {
  const tally = new Map<string, { userId: string; approver: number; reviewer: number }>();
  for (const h of history) {
    const t = tally.get(h.userId) ?? { userId: h.userId, approver: 0, reviewer: 0 };
    t[h.role]++;
    tally.set(h.userId, t);
  }
  return [...tally.values()]
    .map((t) => ({
      userId: t.userId,
      role: (t.approver > t.reviewer ? 'approver' : 'reviewer') as StepRole,
      count: t.approver + t.reviewer,
    }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}
