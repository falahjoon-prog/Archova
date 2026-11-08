// The inspection record page: the status rollup for the donut and the "reopened again and again" flag. Pure.
import type { SectionSummary } from './inspection';

export interface StatusCounts {
  pass: number;
  fail: number;
  na: number;
  /** Items with an answer that is not pass, fail or N/A (a number, text, date, choice, photo or signature). */
  answered: number;
  /** Items still waiting for an answer ("uninspected"). */
  unanswered: number;
  total: number;
}

export function statusCounts(sections: readonly SectionSummary[]): StatusCounts {
  const c: StatusCounts = { pass: 0, fail: 0, na: 0, answered: 0, unanswered: 0, total: 0 };
  for (const s of sections) {
    c.pass += s.pass;
    c.fail += s.fail;
    c.na += s.na;
    c.answered += s.answered;
    c.unanswered += s.unanswered;
    c.total += s.items;
  }
  return c;
}

/** Reopened twice or more is a possible process problem: the work is being signed off before it is ready. */
export const REOPEN_FLAG_AT = 2;

export interface ReopenFlag {
  code: 'reopened_repeatedly';
  count: number;
  message: string;
}

export function reopenFlag(reopenCount: number): ReopenFlag | null {
  if (reopenCount < REOPEN_FLAG_AT) return null;
  return {
    code: 'reopened_repeatedly',
    count: reopenCount,
    message: `Reopened ${reopenCount} times. Check whether it is being signed off before the work is ready.`,
  };
}

/** Whether a private inspection is visible to this person: the people on it, or anyone who can close inspections. */
export function canSeePrivate(
  i: {
    isPrivate: boolean;
    createdBy: string | null;
    inspectorId: string | null;
    assigneeIds: readonly string[];
  },
  userId: string,
  canClose: boolean,
): boolean {
  if (!i.isPrivate || canClose) return true;
  return i.createdBy === userId || i.inspectorId === userId || i.assigneeIds.includes(userId);
}
