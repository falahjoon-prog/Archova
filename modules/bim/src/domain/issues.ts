// Coordination issue lifecycle. Pure rules, no IO.
//   open → in_progress → resolved → closed, and a resolved or closed issue can be reopened.
import type { IssueStatus } from '../infra/tables';

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

const NEXT: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export const canMove = (from: IssueStatus, to: IssueStatus) => NEXT[from].includes(to);

/** "3f2a…" style IFC GlobalIds are 22 characters of base64; people paste them with stray spaces and duplicates. */
export function cleanGuids(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const g = raw.trim();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}
